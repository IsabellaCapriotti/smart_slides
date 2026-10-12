import { z } from 'zod';
import { CHART_TYPES, type ChartType, type Finding, type Row } from '@smart-slides/shared';
import { callTool } from './llm';
import { cleanChartRows } from './chartData';
import { dropDuplicates } from './dedupe';
import { profileForPrompt, runSql } from './data';
import type { Session } from './sessions';

const ChartTypeEnum = z.enum(CHART_TYPES);

const HypothesesSchema = z.object({
  hypotheses: z
    .array(
      z.object({
        id: z.string().describe('Short unique id like h1, h2'),
        title: z.string().describe('The claim being tested, in plain language'),
        sql: z.string().describe('SQLite SELECT that returns chart-ready aggregated rows'),
        chartType: ChartTypeEnum,
        xKey: z.string().describe('Result column used for the x axis / categories'),
        yKeys: z.array(z.string()).min(1).describe('Numeric result columns to plot'),
      }),
    )
    .min(1),
});

const FinalSchema = z.object({
  findings: z.array(
    z.object({
      id: z.string().describe('The hypothesis id this finding is based on'),
      headline: z.string().describe('A specific, number-backed claim, max ~15 words'),
      narrative: z.string().describe('1-2 sentences explaining why it matters; mention caveats if the sample is small'),
      keyFigures: z
        .array(z.object({ value: z.string(), label: z.string() }))
        .max(3)
        .describe('2-3 headline numbers that appear in the result rows (value like "+42%" or "1,204")'),
      chartType: ChartTypeEnum,
      xKey: z.string(),
      yKeys: z.array(z.string()).min(1),
      xLabel: z.string().optional(),
      yLabel: z.string().optional(),
      significance: z.number().min(1).max(5).describe('1-5: how impactful and well-supported this finding is'),
    }),
  ),
});

const CHART_RULES = `Chart-ready SQL rules:
- Query the tables listed in the schema (SQLite dialect). Use the exact table and column names.
- When there are several tables, JOIN them using the detected relationships. Aggregate on the "many" side or use COUNT(DISTINCT ...) so joins never double-count rows. Qualify columns with table aliases.
- Return AGGREGATED rows only (<= 30 rows). The first column is the x axis / category; the other columns are numeric series.
- For several series over time or segments, pivot with CASE WHEN so each series is its own column (never long format).
- Time bucketing: strftime('%Y', col), strftime('%Y-%m', col). Percentages: ROUND(100.0 * x / y, 1).
- Order rows meaningfully (chronologically for time, by value for categories).
- Chart types: line/area = trends over time; bar = comparing categories; stacked-bar = composition; pie = share of a whole (<= 6 slices); scatter = relationship between two numeric columns (xKey numeric).
- Bar / stacked-bar / pie rules (the chart renders EXACTLY one bar or slice per row, labelled by the x column):
  * xKey must be a human-readable text label column (e.g. a name, category, region, or a bucketed year). Never use an id, a code, or a raw timestamp as the label.
  * Exactly ONE row per category: always GROUP BY the label. Never return the same label twice.
  * 3 to 12 categories is ideal (hard max 25). Use ORDER BY <metric> DESC LIMIT 10 to keep the top N.
  * Labels should be short (<= 20 characters). Shorten or alias long values with CASE / SUBSTR.
  * No NULL labels: use COALESCE(col, 'Unknown'). Every series column must be numeric and non-null (COALESCE(x, 0)).
  * Alias columns with clean, readable names (e.g. AS region, AS revenue); xKey and yKeys must match the result column names exactly.
  * Order bars meaningfully: by value descending, or by natural order (weekday, age band, year).`;

export async function generateFindings(
  session: Session,
  opts: { focus?: string; existing?: Finding[]; count?: number; onProgress?: (m: string) => void } = {},
): Promise<Finding[]> {
  const { db, profile } = session.dataset;
  const progress = opts.onProgress ?? (() => {});
  const want = opts.count ?? 8;
  const existingList = opts.existing ?? [];
  const existing = existingList.length
    ? `\nAlready covered (do NOT repeat, restate, or slightly reword these):\n- ${existingList.map((i) => i.headline).join('\n- ')}`
    : '';
  const focus = opts.focus ? `\nThe user specifically wants findings about: ${opts.focus}` : '';

  progress('Studying your data and proposing hypotheses…');
  const { hypotheses } = await callTool<z.infer<typeof HypothesesSchema>>({
    system:
      'You are a senior data analyst preparing findings for an executive presentation. ' +
      'You find impactful, presentable trends: changes over time, differences between segments, ' +
      'relationships between a behaviour and an outcome, cross-entity effects across related tables, and outliers. Avoid trivial facts like row counts or ' +
      'simple distributions unless they are surprising.\n\n' +
      CHART_RULES,
    user:
      `${profileForPrompt(profile)}${existing}${focus}\n\n` +
      `Propose ${want + 4} distinct hypotheses, each with a SQL query that tests it and returns chart-ready rows.` +
      (profile.tables.length > 1
        ? ' The data spans multiple related tables: at least half of the hypotheses must draw conclusions ACROSS tables ' +
          '(e.g. how an attribute of one entity affects behaviour or outcomes recorded in another), not just describe one table.'
        : ''),
    tool: {
      name: 'propose_hypotheses',
      description: 'Submit candidate findings with the SQL that tests each one.',
      schema: HypothesesSchema,
    },
    maxTokens: 6000,
  });

  progress(`Running ${hypotheses.length} checks against the data…`);
  const results: { h: (typeof hypotheses)[number]; rows: Row[] }[] = [];
  for (const h of hypotheses) {
    try {
      const raw = runSql(db, h.sql, 60);
      if (raw.length < 2) continue;
      const cols = Object.keys(raw[0]);
      if (!cols.includes(h.xKey) || !h.yKeys.every((k) => cols.includes(k))) continue;
      const rows = cleanChartRows(raw, h.xKey, h.yKeys, h.chartType);
      if (rows.length < 2) continue;
      results.push({ h, rows });
    } catch {
      // A bad query just drops that hypothesis.
    }
  }
  if (!results.length) throw new Error('None of the generated analyses produced usable results. Try again.');

  progress('Reviewing the evidence and writing up the strongest findings…');
  const evidence = results
    .map(({ h, rows }) => `### ${h.id}: ${h.title}\ncolumns: ${Object.keys(rows[0]).join(', ')}\nrows: ${JSON.stringify(rows.slice(0, 30))}`)
    .join('\n\n');

  const final = await callTool<z.infer<typeof FinalSchema>>({
    system:
      'You are a senior data analyst. You are given query results for candidate findings. ' +
      'Keep only those where the data clearly supports a notable, presentable finding. Drop weak, flat, or noisy ones. ' +
      'Every number you cite MUST appear in or be directly computable from the rows shown. Never invent figures. ' +
      'Prefer findings that are specific (who/what/when/how much).',
    user:
      `${evidence}${existing}\n\nSelect up to ${want} findings, ranked by significance. ` +
      `Each must make a distinct claim from the others and from anything already covered.${focus}`,
    tool: {
      name: 'finalize_findings',
      description: 'Submit the final, evidence-backed findings.',
      schema: FinalSchema,
    },
    maxTokens: 5000,
  });

  const byId = new Map(results.map((r) => [r.h.id, r]));
  const findings: Finding[] = [];
  for (const f of final.findings) {
    const src = byId.get(f.id);
    if (!src) continue;
    const cols = Object.keys(src.rows[0]);
    const xKey = cols.includes(f.xKey) ? f.xKey : src.h.xKey;
    const yKeys = f.yKeys.every((k) => cols.includes(k)) ? f.yKeys : src.h.yKeys;
    let data = src.rows;
    try {
      // The model may have changed chart type or columns, so validate the final combination.
      data = cleanChartRows(src.rows, xKey, yKeys, f.chartType as ChartType);
    } catch {
      continue;
    }
    findings.push({
      id: `${f.id}-${Math.random().toString(36).slice(2, 6)}`,
      headline: f.headline,
      narrative: f.narrative,
      keyFigures: f.keyFigures,
      significance: f.significance,
      sql: src.h.sql,
      chart: {
        chartType: f.chartType as ChartType,
        xKey,
        yKeys,
        xLabel: f.xLabel,
        yLabel: f.yLabel,
        data,
      },
    });
  }
  findings.sort((a, b) => b.significance - a.significance);
  // Models often re-propose the same finding in different words, so filter in code, not just in the prompt.
  return dropDuplicates(findings, existingList);
}
