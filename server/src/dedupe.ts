import type { Finding } from '@smart-slides/shared';

const STOP = new Set(
  'a an and are as at be by for from has have in into is it its of on or over than that the their this to was were with while across per vs versus more most less least higher lower than up down'.split(
    ' ',
  ),
);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9%.\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t && !STOP.has(t)),
  );
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const normSql = (sql: string) => sql.toLowerCase().replace(/\s+/g, ' ').replace(/;\s*$/, '').trim();

/** Identifiers (tables/columns) referenced by a query, as a rough "what is this about" fingerprint. */
function identifiers(sql: string): Set<string> {
  return new Set(
    (normSql(sql).match(/[a-z_][a-z0-9_]*/g) ?? []).filter(
      (t) => !/^(select|from|where|group|by|order|limit|join|on|as|and|or|not|null|case|when|then|else|end|count|sum|avg|min|max|round|cast|real|text|integer|desc|asc|distinct|strftime|coalesce|having|inner|left|outer|with|in|is|like|between|substr|length|union|all)$/.test(t),
    ),
  );
}

/** True when two findings make essentially the same claim or show the same evidence. */
export function isDuplicate(a: Finding, b: Finding): boolean {
  if (normSql(a.sql) === normSql(b.sql)) return true;
  // Same chart data means same evidence, however it is worded.
  if (JSON.stringify(a.chart.data) === JSON.stringify(b.chart.data)) return true;

  const headline = jaccard(tokens(a.headline), tokens(b.headline));
  if (headline >= 0.5) return true;

  // Same columns analysed with a broadly similar claim.
  const sameSubject = jaccard(identifiers(a.sql), identifiers(b.sql)) >= 0.8;
  const sharedFigures = a.keyFigures.some((k) => b.keyFigures.some((j) => k.value === j.value));
  if (sameSubject && (headline >= 0.3 || sharedFigures)) return true;
  return false;
}

/** Drops candidates that duplicate an existing finding or an earlier candidate. Keeps order. */
export function dropDuplicates(candidates: Finding[], existing: Finding[]): Finding[] {
  const kept: Finding[] = [];
  for (const c of candidates) {
    if (existing.some((e) => isDuplicate(c, e)) || kept.some((k) => isDuplicate(c, k))) continue;
    kept.push(c);
  }
  return kept;
}
