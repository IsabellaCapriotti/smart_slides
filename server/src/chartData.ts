import type { ChartType, Row } from '@smart-slides/shared';

const MAX_CATEGORIES: Record<ChartType, number> = {
  bar: 25,
  'stacked-bar': 25,
  pie: 8,
  line: 60,
  area: 60,
  scatter: 500,
};

/**
 * Validates and normalises query rows for charting. Returns cleaned rows, or throws an error
 * whose message tells the model exactly how to fix its SQL.
 *
 * Catches the most common reasons charts render badly: rows without a category label,
 * the same category appearing twice (bars that don't match the categories), non-numeric
 * series values, and too many categories to read.
 */
export function cleanChartRows(rows: Row[], xKey: string, yKeys: string[], chartType: ChartType): Row[] {
  const scatter = chartType === 'scatter';
  const out: Row[] = [];
  const seen = new Set<string>();

  for (const r of rows) {
    const raw = r[xKey];
    if (raw === null || raw === undefined || String(raw).trim() === '') continue; // unlabeled row

    const row: Row = { ...r };
    if (scatter) {
      const x = Number(raw);
      if (!Number.isFinite(x)) {
        throw new Error(`Scatter charts need a numeric x column, but "${xKey}" contains "${raw}". Use a numeric column.`);
      }
      row[xKey] = x;
    } else {
      const label = typeof raw === 'number' ? raw : String(raw).trim();
      const k = String(label);
      if (seen.has(k)) {
        throw new Error(
          `Category "${k}" appears more than once in column "${xKey}". Use GROUP BY so there is exactly one row per category ` +
            `(and one column per series), then try again.`,
        );
      }
      seen.add(k);
      row[xKey] = label;
    }

    for (const y of yKeys) {
      const v = r[y];
      if (v === null || v === undefined || v === '') {
        row[y] = 0;
        continue;
      }
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) {
        throw new Error(`Series column "${y}" must be numeric but contains "${v}". Pick a numeric column or CAST/aggregate it.`);
      }
      row[y] = n;
    }
    out.push(row);
  }

  if (!out.length) throw new Error(`No usable rows: every row had an empty "${xKey}" value.`);
  const max = MAX_CATEGORIES[chartType];
  if (out.length > max) {
    throw new Error(
      `${out.length} rows is too many for a ${chartType} chart (max ${max}). Keep the top N with ORDER BY ... DESC LIMIT ${Math.min(12, max)}, or bucket the categories.`,
    );
  }
  return out;
}
