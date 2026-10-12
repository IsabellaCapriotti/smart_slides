import Papa from 'papaparse';
import initSqlJs, { type Database } from 'sql.js';
import type {
  ColumnProfile,
  DataProfile,
  Relationship,
  Row,
  TableProfile,
  UploadedFile,
} from '@smart-slides/shared';

const MAX_FILES = 8;
const MAX_ROWS_PER_FILE = 200_000;
const MAX_ROWS_TOTAL = 500_000;
const NULL_TOKENS = new Set(['', 'na', 'n/a', 'null', 'nan', 'none', '-']);

let sqlPromise: ReturnType<typeof initSqlJs> | undefined;
const getSql = () => (sqlPromise ??= initSqlJs());

export interface Dataset {
  db: Database;
  profile: DataProfile;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const NUMBER = /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i;
const NUMBER_COMMAS = /^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
/** Column names that identify an entity; treated as text so they are never averaged or summed. */
const ID_NAME = /(^|_)(id|key|uuid)$/;

function parseNumber(v: string): number | null {
  const s = v.trim();
  if (NUMBER.test(s)) return Number(s);
  if (NUMBER_COMMAS.test(s)) return Number(s.replace(/,/g, ''));
  return null;
}

/** Normalises a date-looking string to `YYYY-MM-DD[ HH:MM:SS]` so SQLite date functions work. */
function parseDate(v: string): string | null {
  const s = v.trim();
  if (ISO_DATE.test(s)) {
    return s.replace('T', ' ').replace(/(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/, '').replace(/\.\d+$/, '');
  }
  const m = US_DATE.exec(s);
  if (m) {
    const [, mo, d, y] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

function toIdentifier(raw: string, used: Set<string>, fallback: string): string {
  let id = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!id) id = fallback;
  if (/^\d/.test(id)) id = `c_${id}`;
  let candidate = id;
  let n = 2;
  while (used.has(candidate)) candidate = `${id}_${n++}`;
  used.add(candidate);
  return candidate;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Parses one CSV, creates its table in `db`, and returns its profile. */
function loadTable(db: Database, name: string, file: UploadedFile, warnings: string[]): TableProfile {
  const clean = file.csv.replace(/^﻿/, '');
  const parsed = Papa.parse<Record<string, string>>(clean, { header: true, skipEmptyLines: 'greedy' });
  const rawFields = parsed.meta.fields ?? [];
  if (!rawFields.length || !parsed.data.length) {
    throw new Error(`"${file.name}" looks empty, or is not a valid CSV with a header row.`);
  }
  if (parsed.data.length > MAX_ROWS_PER_FILE) {
    const dropped = parsed.data.length - MAX_ROWS_PER_FILE;
    warnings.push(
      `"${file.name}": this POC only supports ${MAX_ROWS_PER_FILE.toLocaleString()} rows per file, ` +
        `so the last ${dropped.toLocaleString()} rows of your upload have been truncated.`,
    );
    parsed.data.length = MAX_ROWS_PER_FILE;
  }

  const used = new Set<string>();
  const names = rawFields.map((f, i) => toIdentifier(f, used, `column_${i + 1}`));

  const columns = rawFields.map((raw, ci) => {
    const values: (string | null)[] = parsed.data.map((row) => {
      const v = row[raw];
      if (v === undefined || v === null) return null;
      const s = String(v).trim();
      return NULL_TOKENS.has(s.toLowerCase()) ? null : s;
    });
    const present = values.filter((v): v is string => v !== null);
    const share = (fn: (v: string) => unknown) =>
      present.length ? present.filter((v) => fn(v) !== null).length / present.length : 0;
    let type: ColumnProfile['type'] = 'text';
    if (present.length && share(parseNumber) >= 0.95) type = 'number';
    else if (present.length && share(parseDate) >= 0.95) type = 'date';
    // Numeric identifiers (customer_id = 1042) are labels, not quantities, and must join as text.
    if (type === 'number' && ID_NAME.test(names[ci])) type = 'text';
    const typed: (string | number | null)[] = values.map((v) => {
      if (v === null) return null;
      if (type === 'number') return parseNumber(v);
      if (type === 'date') return parseDate(v);
      // Canonicalise numeric-looking ids ("1042.0" -> "1042") so joins across files line up.
      return ID_NAME.test(names[ci]) && NUMBER.test(v) ? String(Number(v)) : v;
    });
    return { name: names[ci], type, typed };
  });

  const ddl = columns.map((c) => `"${c.name}" ${c.type === 'number' ? 'REAL' : 'TEXT'}`).join(', ');
  db.run(`CREATE TABLE "${name}" (${ddl})`);
  const insert = db.prepare(`INSERT INTO "${name}" VALUES (${columns.map(() => '?').join(',')})`);
  db.run('BEGIN');
  for (let r = 0; r < parsed.data.length; r++) {
    insert.run(columns.map((c) => c.typed[r]));
  }
  db.run('COMMIT');
  insert.free();

  const profiles: ColumnProfile[] = columns.map((c) => {
    const present = c.typed.filter((v): v is string | number => v !== null);
    const counts = new Map<string, number>();
    for (const v of present) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
    const p: ColumnProfile = {
      name: c.name,
      type: c.type,
      nulls: c.typed.length - present.length,
      distinct: counts.size,
    };
    if (c.type === 'number') {
      const nums = (present as number[]).slice().sort((a, b) => a - b);
      if (nums.length) {
        p.min = nums[0];
        p.max = nums[nums.length - 1];
        p.mean = round(nums.reduce((s, n) => s + n, 0) / nums.length);
        p.median = round(median(nums));
      }
    } else if (c.type === 'date') {
      const sorted = (present as string[]).slice().sort();
      p.min = sorted[0];
      p.max = sorted[sorted.length - 1];
    }
    if (c.type === 'text' || counts.size <= 12) {
      p.topValues = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([value, count]) => ({ value: value.length > 60 ? `${value.slice(0, 57)}...` : value, count }));
    }
    return p;
  });

  const sampleRows: Row[] = [];
  for (let r = 0; r < Math.min(3, parsed.data.length); r++) {
    const row: Row = {};
    columns.forEach((c) => {
      const v = c.typed[r];
      row[c.name] = typeof v === 'string' && v.length > 80 ? `${v.slice(0, 77)}...` : v;
    });
    sampleRows.push(row);
  }

  return { name, fileName: file.name, rowCount: parsed.data.length, columns: profiles, sampleRows };
}

/**
 * Finds likely foreign-key relationships between tables. A pair is a candidate when the column
 * names match, or one of them looks like an identifier; it is confirmed when at least 80% of the
 * distinct values on one side appear on the other.
 */
function detectRelationships(db: Database, tables: TableProfile[]): Relationship[] {
  const found: Relationship[] = [];
  const seen = new Set<string>();
  for (const a of tables) {
    for (const b of tables) {
      if (a === b) continue;
      for (const ca of a.columns) {
        for (const cb of b.columns) {
          if (ca.type !== cb.type || ca.type === 'date') continue;
          if (!ca.distinct || !cb.distinct) continue;
          const sameName = ca.name === cb.name;
          const idLike = (ID_NAME.test(ca.name) || ID_NAME.test(cb.name)) && (ca.name.endsWith(cb.name) || cb.name.endsWith(ca.name) || /^id$/.test(ca.name) || /^id$/.test(cb.name));
          if (!sameName && !idLike) continue;
          if (ca.type === 'number' && !sameName) continue;
          // Direction: `from` is the side whose values should be contained in the other.
          // Prefer the more unique column as the "to" (parent) side.
          const aUnique = ca.distinct / Math.max(1, a.rowCount - ca.nulls) > 0.98;
          const bUnique = cb.distinct / Math.max(1, b.rowCount - cb.nulls) > 0.98;
          if (aUnique && !bUnique) continue; // handled when the loops visit (b -> a)
          const key = [a.name, ca.name, b.name, cb.name].sort().join('|');
          if (seen.has(key)) continue;
          const res = db.exec(
            `SELECT COUNT(*) FROM (SELECT DISTINCT "${ca.name}" v FROM "${a.name}" WHERE "${ca.name}" IS NOT NULL) ` +
              `WHERE v IN (SELECT "${cb.name}" FROM "${b.name}")`,
          );
          const hits = Number(res[0]?.values[0]?.[0] ?? 0);
          const coverage = hits / ca.distinct;
          if (coverage < 0.8) continue;
          seen.add(key);
          found.push({
            fromTable: a.name,
            fromColumn: ca.name,
            toTable: b.name,
            toColumn: cb.name,
            coveragePct: Math.round(coverage * 1000) / 10,
            toUnique: bUnique,
          });
        }
      }
    }
  }
  return found;
}

export async function loadDatasets(files: UploadedFile[]): Promise<Dataset> {
  if (!files.length) throw new Error('No files were provided.');
  if (files.length > MAX_FILES) throw new Error(`Please upload at most ${MAX_FILES} files at once.`);

  const SQL = await getSql();
  const db = new SQL.Database();
  const used = new Set<string>();
  const tables: TableProfile[] = [];
  const warnings: string[] = [];
  try {
    for (const file of files) {
      const base = file.name.replace(/\.[^.]+$/, '');
      const name = toIdentifier(base, used, `table_${tables.length + 1}`);
      tables.push(loadTable(db, name, file, warnings));
    }
    const total = tables.reduce((s, t) => s + t.rowCount, 0);
    if (total > MAX_ROWS_TOTAL) {
      throw new Error(`Total of ${total.toLocaleString()} rows exceeds the POC limit of ${MAX_ROWS_TOTAL.toLocaleString()}.`);
    }
    const relationships = detectRelationships(db, tables);
    return {
      db,
      profile: { fileName: files.map((f) => f.name).join(', '), rowCount: total, tables, relationships, warnings },
    };
  } catch (err) {
    db.close();
    throw err;
  }
}

const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|attach|detach|pragma|vacuum|reindex)\b/i;

/** Runs a single read-only SELECT and returns rows as objects. Throws a readable error otherwise. */
export function runSql(db: Database, sql: string, maxRows = 500): Row[] {
  const q = sql.trim().replace(/;+\s*$/, '');
  if (!/^(select|with)\b/i.test(q)) throw new Error('Only a single SELECT (or WITH ... SELECT) query is allowed.');
  if (q.includes(';')) throw new Error('Only one statement per query is allowed.');
  if (FORBIDDEN.test(q)) throw new Error('Query contains a forbidden keyword; only read-only SELECTs are allowed.');
  const result = db.exec(q);
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.slice(0, maxRows).map((vals) => {
    const row: Row = {};
    columns.forEach((c, i) => {
      const v = vals[i];
      row[c] = typeof v === 'number' ? Math.round(v * 10000) / 10000 : ((v as string | null) ?? null);
    });
    return row;
  });
}

/** Compact schema text for LLM prompts. */
export function profileForPrompt(profile: DataProfile): string {
  const out: string[] = [
    `SQLite database with ${profile.tables.length} table${profile.tables.length === 1 ? '' : 's'} (${profile.rowCount} rows total).`,
  ];
  for (const t of profile.tables) {
    out.push(`\nTable "${t.name}" (from ${t.fileName}, ${t.rowCount} rows):`);
    for (const c of t.columns) {
      const parts = [`${c.name} (${c.type})`];
      if (c.nulls) parts.push(`nulls=${c.nulls}`);
      parts.push(`distinct=${c.distinct}`);
      if (c.type === 'number') parts.push(`min=${c.min} max=${c.max} mean=${c.mean} median=${c.median}`);
      if (c.type === 'date') parts.push(`range=${c.min}..${c.max}`);
      if (c.topValues) parts.push(`top=${c.topValues.map((v) => `${v.value}:${v.count}`).join(', ')}`);
      out.push(`- ${parts.join(' | ')}`);
    }
    out.push(`Sample rows: ${JSON.stringify(t.sampleRows)}`);
  }
  if (profile.relationships.length) {
    out.push('\nDetected relationships (join keys):');
    for (const r of profile.relationships) {
      out.push(
        `- ${r.fromTable}.${r.fromColumn} -> ${r.toTable}.${r.toColumn} ` +
          `(${r.coveragePct}% of values match; ${r.toUnique ? `many-to-one: each ${r.fromTable} row maps to at most one ${r.toTable} row` : 'NOT unique on the target side: joining multiplies rows'})`,
      );
    }
  } else if (profile.tables.length > 1) {
    out.push('\nNo join keys were detected between the tables; treat them as independent.');
  }
  return out.join('\n');
}
