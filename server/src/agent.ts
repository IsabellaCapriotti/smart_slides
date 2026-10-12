import { z } from 'zod';
import {
  CHART_TYPES,
  LAYOUTS,
  LAYOUT_DESCRIPTIONS,
  REGIONS,
  THEMES,
  normalizeSlide,
  summarizeDeck,
  uid,
  type ChartElement,
  type ChatMessage,
  type Deck,
  type Finding,
  type Slide,
  type SlideElement,
  type StreamEvent,
} from '@smart-slides/shared';
import { getProvider, type Msg, type ToolDef } from './llm';
import { cleanChartRows } from './chartData';
import { profileForPrompt, runSql } from './data';
import { generateFindings } from './findings';
import type { Session } from './sessions';

const Region = z.enum(REGIONS);
const ChartType = z.enum(CHART_TYPES);

const chartFields = {
  chartType: ChartType,
  sql: z.string().describe('SQLite SELECT producing the chart rows. First column is x; other columns are numeric series.'),
  xKey: z.string().describe('Result column for the x axis / categories'),
  yKeys: z.array(z.string()).min(1).describe('Result columns to plot as series'),
  title: z.string().optional(),
  xLabel: z.string().optional(),
  yLabel: z.string().optional(),
};

const ElementInput = z.discriminatedUnion('type', [
  z.object({ type: z.literal('title'), text: z.string(), region: Region.optional() }),
  z.object({ type: z.literal('subtitle'), text: z.string(), region: Region.optional() }),
  z.object({ type: z.literal('text'), text: z.string(), region: Region.optional() }),
  z.object({ type: z.literal('bullets'), items: z.array(z.string()).min(1), region: Region.optional() }),
  z.object({ type: z.literal('stat'), value: z.string(), label: z.string(), region: Region.optional() }),
  z.object({ type: z.literal('chart'), ...chartFields, region: Region.optional() }),
]);
type ElementInput = z.infer<typeof ElementInput>;

const tools = {
  run_sql: {
    name: 'run_sql',
    description:
      'Run a read-only SQLite SELECT against the uploaded dataset (one or more tables; JOIN related tables on their detected keys) and get up to 50 rows back. ' +
      'Use it to check numbers before putting them on a slide.',
    schema: z.object({ sql: z.string() }),
  },
  set_theme: {
    name: 'set_theme',
    description: `Change the deck's visual theme. Available: ${THEMES.map((t) => `${t.id} (${t.name}: ${t.description})`).join('; ')}`,
    schema: z.object({ themeId: z.enum(THEMES.map((t) => t.id) as [string, ...string[]]) }),
  },
  add_slide: {
    name: 'add_slide',
    description:
      'Add a new slide. Layouts: ' +
      LAYOUTS.map((l) => `${l} (${LAYOUT_DESCRIPTIONS[l]})`).join('; ') +
      '. Each element goes in a region; elements in the same region stack top to bottom. ' +
      'Typical content slide: layout "split" with a title in header, a chart in left, stat/bullets in right. ' +
      'Chart elements are filled by running their sql.',
    schema: z.object({
      layout: z.enum(LAYOUTS),
      elements: z.array(ElementInput).min(1),
      position: z.number().int().optional().describe('1-based position to insert at; omit to append'),
    }),
  },
  add_element: {
    name: 'add_element',
    description: 'Add an element to an existing slide.',
    schema: z.object({ slideId: z.string(), element: ElementInput }),
  },
  update_element: {
    name: 'update_element',
    description:
      'Change fields of an existing element. Only pass the fields to change. ' +
      'Set `region` to move it. For charts, `sql` re-runs the query; `chartType` changes the visualization.',
    schema: z.object({
      slideId: z.string(),
      elementId: z.string(),
      region: Region.optional(),
      text: z.string().optional(),
      items: z.array(z.string()).optional(),
      value: z.string().optional(),
      label: z.string().optional(),
      chartType: ChartType.optional(),
      sql: z.string().optional(),
      xKey: z.string().optional(),
      yKeys: z.array(z.string()).optional(),
      title: z.string().optional(),
      xLabel: z.string().optional(),
      yLabel: z.string().optional(),
    }),
  },
  remove_element: {
    name: 'remove_element',
    description: 'Remove an element from a slide.',
    schema: z.object({ slideId: z.string(), elementId: z.string() }),
  },
  set_slide_layout: {
    name: 'set_slide_layout',
    description: 'Change a slide layout. Elements whose region does not exist in the new layout are moved automatically.',
    schema: z.object({ slideId: z.string(), layout: z.enum(LAYOUTS) }),
  },
  delete_slide: {
    name: 'delete_slide',
    description: 'Delete a slide.',
    schema: z.object({ slideId: z.string() }),
  },
  move_slide: {
    name: 'move_slide',
    description: 'Move a slide to a new 1-based position.',
    schema: z.object({ slideId: z.string(), position: z.number().int().min(1) }),
  },
  suggest_findings: {
    name: 'suggest_findings',
    description:
      'Generate NEW verified findings from the data (optionally around a focus). Returns headlines and chart specs; ' +
      'it does not change the deck. Present them to the user and let them choose which to add.',
    schema: z.object({ focus: z.string().optional() }),
  },
  add_finding_slide: {
    name: 'add_finding_slide',
    description:
      'Add a slide for one of the findings returned earlier by suggest_findings, by its number. The slide is built from ' +
      'the verified chart data and key figures of the chosen finding, exactly as computed, so no SQL needs to be re-typed. ' +
      'Prefer this over add_slide when the user picks a suggested finding.',
    schema: z.object({
      number: z.number().int().min(1),
      position: z.number().int().optional().describe('1-based position to insert at; omit to append'),
    }),
  },
} satisfies Record<string, ToolDef>;

type ToolName = keyof typeof tools;

interface Ctx {
  session?: Session;
  deck: Deck;
  emit: (e: StreamEvent) => void;
  /** Findings suggested by this session's agent (shared with the session, so numbers persist across turns). */
  suggested: Finding[];
}

function findSlide(deck: Deck, id: string): Slide {
  const s = deck.slides.find((x) => x.id === id);
  if (!s) throw new Error(`No slide with id "${id}". Valid ids: ${deck.slides.map((x) => x.id).join(', ')}`);
  return s;
}

function findElement(slide: Slide, id: string): SlideElement {
  const e = slide.elements.find((x) => x.id === id);
  if (!e) throw new Error(`No element "${id}" on slide ${slide.id}. Valid ids: ${slide.elements.map((x) => x.id).join(', ')}`);
  return e;
}

function runChartQuery(ctx: Ctx, sql: string, xKey: string, yKeys: string[], chartType: ChartElement['chartType']) {
  if (!ctx.session) throw new Error('The dataset is not loaded in this session, so charts cannot be re-queried.');
  const rows = runSql(ctx.session.dataset.db, sql, 201);
  if (!rows.length) throw new Error('The query returned no rows.');
  if (rows.length > 200) throw new Error('The query returned more than 200 rows; aggregate it further for a chart.');
  const cols = Object.keys(rows[0]);
  const missing = [xKey, ...yKeys].filter((k) => !cols.includes(k));
  if (missing.length) throw new Error(`Columns not in the query result: ${missing.join(', ')}. Result columns: ${cols.join(', ')}`);
  return cleanChartRows(rows, xKey, yKeys, chartType);
}

function defaultRegion(layout: Slide['layout'], type: SlideElement['type']): SlideElement['region'] {
  if (type === 'title' || type === 'subtitle') return layout === 'title' ? 'main' : 'header';
  if (layout === 'title') return 'main';
  if (layout === 'full') return 'main';
  return type === 'chart' ? 'left' : 'right';
}

function buildElement(ctx: Ctx, layout: Slide['layout'], input: ElementInput): SlideElement {
  const region = input.region ?? defaultRegion(layout, input.type);
  const id = uid();
  switch (input.type) {
    case 'chart': {
      const yKeys = input.chartType === 'pie' || input.chartType === 'scatter' ? input.yKeys.slice(0, 1) : input.yKeys;
      const data = runChartQuery(ctx, input.sql, input.xKey, yKeys, input.chartType);
      const el: ChartElement = {
        id,
        region,
        type: 'chart',
        chartType: input.chartType,
        title: input.title,
        xKey: input.xKey,
        yKeys,
        xLabel: input.xLabel,
        yLabel: input.yLabel,
        data,
        sql: input.sql,
      };
      return el;
    }
    case 'bullets':
      return { id, region, type: 'bullets', items: input.items };
    case 'stat':
      return { id, region, type: 'stat', value: input.value, label: input.label };
    default:
      return { id, region, type: input.type, text: input.text };
  }
}

type Input<N extends ToolName> = z.infer<(typeof tools)[N]['schema']>;

async function execute(ctx: Ctx, name: ToolName, raw: unknown): Promise<{ result: string; summary: string; mutated: boolean }> {
  const schema = tools[name].schema;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid arguments: ${z.prettifyError(parsed.error)}`);
  const input = parsed.data as never;
  const { deck } = ctx;

  switch (name) {
    case 'run_sql': {
      if (!ctx.session) throw new Error('No dataset is loaded in this session.');
      const { sql } = input as Input<'run_sql'>;
      const rows = runSql(ctx.session.dataset.db, sql, 50);
      return { result: JSON.stringify({ rowCount: rows.length, rows }), summary: 'Queried the data', mutated: false };
    }
    case 'set_theme': {
      const { themeId } = input as Input<'set_theme'>;
      deck.themeId = themeId;
      return { result: `Theme set to ${themeId}.`, summary: `Applied the ${themeId} theme`, mutated: true };
    }
    case 'add_slide': {
      const { layout, elements, position } = input as Input<'add_slide'>;
      const slide: Slide = { id: uid(), layout, elements: elements.map((e) => buildElement(ctx, layout, e)) };
      const normalized = normalizeSlide(slide);
      const idx = position ? Math.min(Math.max(position - 1, 0), deck.slides.length) : deck.slides.length;
      deck.slides.splice(idx, 0, normalized);
      return {
        result: `Added slide id=${slide.id} at position ${idx + 1}. Element ids: ${normalized.elements.map((e) => `${e.id}(${e.type})`).join(', ')}`,
        summary: 'Added a slide',
        mutated: true,
      };
    }
    case 'add_element': {
      const { slideId, element } = input as Input<'add_element'>;
      const slide = findSlide(deck, slideId);
      const el = buildElement(ctx, slide.layout, element);
      slide.elements.push(el);
      Object.assign(slide, normalizeSlide(slide));
      return { result: `Added element id=${el.id}.`, summary: `Added a ${el.type}`, mutated: true };
    }
    case 'update_element': {
      const c = input as Input<'update_element'>;
      const slide = findSlide(deck, c.slideId);
      const el = findElement(slide, c.elementId);
      if (c.region) el.region = c.region;
      if (c.text !== undefined && 'text' in el) el.text = c.text;
      if (c.items && el.type === 'bullets') el.items = c.items;
      if (el.type === 'stat') {
        if (c.value !== undefined) el.value = c.value;
        if (c.label !== undefined) el.label = c.label;
      }
      if (el.type === 'chart') {
        if (c.chartType) el.chartType = c.chartType;
        if (c.title !== undefined) el.title = c.title;
        if (c.xLabel !== undefined) el.xLabel = c.xLabel;
        if (c.yLabel !== undefined) el.yLabel = c.yLabel;
        if (c.xKey) el.xKey = c.xKey;
        if (c.yKeys) el.yKeys = c.yKeys;
        if (c.sql) {
          el.sql = c.sql;
          if (el.chartType === 'pie' || el.chartType === 'scatter') el.yKeys = el.yKeys.slice(0, 1);
          el.data = runChartQuery(ctx, c.sql, el.xKey, el.yKeys, el.chartType);
        } else {
          if (el.chartType === 'pie' || el.chartType === 'scatter') el.yKeys = el.yKeys.slice(0, 1);
          if (c.xKey || c.yKeys || c.chartType) {
            const cols = Object.keys(el.data[0] ?? {});
            const missing = [el.xKey, ...el.yKeys].filter((k) => !cols.includes(k));
            if (missing.length) throw new Error(`Columns not in the chart data: ${missing.join(', ')}. Available: ${cols.join(', ')}`);
            // Re-validate the existing rows against the (possibly new) chart type.
            el.data = cleanChartRows(el.data, el.xKey, el.yKeys, el.chartType);
          }
        }
      }
      Object.assign(slide, normalizeSlide(slide));
      return { result: 'Updated.', summary: `Updated a ${el.type}`, mutated: true };
    }
    case 'remove_element': {
      const { slideId, elementId } = input as Input<'remove_element'>;
      const slide = findSlide(deck, slideId);
      findElement(slide, elementId);
      slide.elements = slide.elements.filter((e) => e.id !== elementId);
      return { result: 'Removed.', summary: 'Removed an element', mutated: true };
    }
    case 'set_slide_layout': {
      const { slideId, layout } = input as Input<'set_slide_layout'>;
      const slide = findSlide(deck, slideId);
      slide.layout = layout;
      Object.assign(slide, normalizeSlide(slide));
      return { result: `Layout is now ${layout}.`, summary: `Changed layout to ${layout}`, mutated: true };
    }
    case 'delete_slide': {
      const { slideId } = input as Input<'delete_slide'>;
      findSlide(deck, slideId);
      deck.slides = deck.slides.filter((s) => s.id !== slideId);
      return { result: 'Deleted.', summary: 'Deleted a slide', mutated: true };
    }
    case 'move_slide': {
      const { slideId, position } = input as Input<'move_slide'>;
      const slide = findSlide(deck, slideId);
      deck.slides = deck.slides.filter((s) => s.id !== slideId);
      deck.slides.splice(Math.min(position - 1, deck.slides.length), 0, slide);
      return { result: `Moved to position ${position}.`, summary: 'Reordered slides', mutated: true };
    }
    case 'suggest_findings': {
      if (!ctx.session) throw new Error('No dataset is loaded in this session.');
      const { focus } = input as Input<'suggest_findings'>;
      const existing = [...ctx.session.findings, ...ctx.suggested];
      const findings = await generateFindings(ctx.session, { focus, existing, count: 4 });
      if (!findings.length) {
        return { result: 'No new distinct findings were found. Try a different focus.', summary: 'No new findings found', mutated: false };
      }
      // `suggested` lives on the session, so numbers stay valid in later turns.
      const offset = ctx.suggested.length;
      ctx.suggested.push(...findings);
      const lines = findings.map((i, n) => ({
        number: offset + n + 1,
        headline: i.headline,
        narrative: i.narrative,
        keyFigures: i.keyFigures,
        chartType: i.chart.chartType,
      }));
      return {
        result: `${JSON.stringify(lines)}
To add one to the deck, call add_finding_slide with its number.`,
        summary: 'Generated new findings',
        mutated: false,
      };
    }
    case 'add_finding_slide': {
      const { number, position } = input as Input<'add_finding_slide'>;
      const finding = ctx.suggested[number - 1];
      if (!finding) {
        throw new Error(
          ctx.suggested.length
            ? `No suggested finding #${number}. Valid numbers: 1-${ctx.suggested.length}.`
            : 'No findings have been suggested yet. Call suggest_findings first.',
        );
      }
      const source = `Source: ${ctx.session?.dataset.profile.fileName ?? 'uploaded data'}`;
      const slide: Slide = {
        id: uid(),
        layout: 'split',
        elements: [
          { id: uid(), type: 'title', region: 'header', text: finding.headline },
          {
            id: uid(),
            type: 'chart',
            region: 'left',
            chartType: finding.chart.chartType,
            xKey: finding.chart.xKey,
            yKeys: finding.chart.yKeys,
            xLabel: finding.chart.xLabel,
            yLabel: finding.chart.yLabel,
            data: structuredClone(finding.chart.data),
            sql: finding.sql, // the exact query that produced the data above
          },
          ...finding.keyFigures.slice(0, 2).map((k) => ({ id: uid(), type: 'stat' as const, region: 'right' as const, value: k.value, label: k.label })),
          { id: uid(), type: 'bullets', region: 'right', items: [finding.narrative] },
          { id: uid(), type: 'text', region: 'footer', text: source },
        ],
      };
      const idx = position ? Math.min(Math.max(position - 1, 0), deck.slides.length) : deck.slides.length;
      deck.slides.splice(idx, 0, slide);
      return {
        result: `Added slide id=${slide.id} at position ${idx + 1} for finding #${number}.`,
        summary: 'Added a finding slide',
        mutated: true,
      };
    }
  }
}

function buildSystem(ctx: Ctx): string {
  const dataPart = ctx.session
    ? `DATASET (queryable with run_sql / chart sql):\n${profileForPrompt(ctx.session.dataset.profile)}`
    : 'The dataset is NOT available in this session, so you cannot query data or create/refresh charts from SQL. You can still edit text, layout, theme, order, chart type and labels of existing charts.';
  return `You are the presentation agent inside "Smart Slides". The user builds a data presentation by chatting with you; they cannot edit slides directly, so every change goes through your tools.

How to work:
- Make the change with tools, then reply with ONE or TWO short sentences describing what you did. No markdown headings; keep it conversational.
- Never invent numbers. Verify with run_sql before putting a figure on a slide. Charts must be filled via a chart element's sql.
- Slides have a layout and regions. Moving something ("put the chart on the right") means update_element with a new region (or set_slide_layout). Free-form pixel positioning is not supported; if asked for it, explain and offer the closest option.
- Charts: ${CHART_TYPES.join(', ')}. Use bar for category comparison, line/area for trends, pie only for <= 6 parts of a whole, scatter for two numeric columns.
- Bar/pie charts draw exactly one bar/slice per query row, labelled by xKey. So: xKey must be a short, human-readable text label column (never an id or raw timestamp); GROUP BY it so each category appears exactly once; keep 3-12 categories (ORDER BY value DESC LIMIT 10); COALESCE NULL labels to 'Unknown'; make every yKey a numeric column; alias columns readably, and make xKey/yKeys match the result column names exactly. Pivot multiple series into columns (CASE WHEN), never long format.
- Keep slides minimal: one chart, 2-4 short bullets, up to 2-3 big stats.
- Slide ids and element ids are shown below. Slide numbers are 1-based in conversation.
- If a request is ambiguous in a way that matters, ask one brief question instead of guessing.
- If the user asks for more findings, call suggest_findings and present the results as a short numbered list (use the numbers returned). Add slides only for the ones they choose, with add_finding_slide(number); it reuses the verified chart data exactly, so never re-type that SQL yourself.

CURRENT DECK:
${summarizeDeck(ctx.deck)}

${dataPart}`;
}

/** Providers require alternating roles starting with "user"; merge consecutive turns and drop leading assistant ones. */
export function toProviderMessages(history: ChatMessage[], message: string): Msg[] {
  const msgs: Msg[] = [];
  for (const m of [...history.slice(-16), { role: 'user' as const, content: message }]) {
    if (!m.content.trim()) continue;
    const last = msgs[msgs.length - 1];
    if (last && last.role === m.role) last.content = `${last.content}\n${m.content}`;
    else msgs.push({ role: m.role, content: m.content });
  }
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return msgs;
}

export async function runAgent(opts: {
  session?: Session;
  deck: Deck;
  message: string;
  history: ChatMessage[];
  emit: (e: StreamEvent) => void;
}): Promise<void> {
  const provider = getProvider();
  const ctx: Ctx = { session: opts.session, deck: structuredClone(opts.deck), emit: opts.emit, suggested: opts.session?.suggested ?? [] };

  const msgs = toProviderMessages(opts.history, opts.message);

  const toolList = (Object.values(tools) as ToolDef[]).filter(
    (t) => ctx.session || !['run_sql', 'suggest_findings', 'add_finding_slide'].includes(t.name),
  );

  for (let turn = 0; turn < 10; turn++) {
    const { text, toolCalls } = await provider.chat({
      system: buildSystem(ctx),
      tools: toolList,
      messages: msgs,
      maxTokens: 4096,
      onText: (delta) => ctx.emit({ type: 'text', delta }),
    });
    msgs.push({ role: 'assistant', content: text, toolCalls });
    if (!toolCalls.length) break;

    const results: { id: string; content: string; isError?: boolean }[] = [];
    for (const call of toolCalls) {
      try {
        const out = await execute(ctx, call.name as ToolName, call.input);
        ctx.emit({ type: 'tool', name: call.name, summary: out.summary });
        if (out.mutated) ctx.emit({ type: 'deck', deck: structuredClone(ctx.deck) });
        if (call.name === 'suggest_findings') ctx.emit({ type: 'findings', findings: ctx.suggested });
        results.push({ id: call.id, content: out.result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.emit({ type: 'tool', name: call.name, summary: `Failed: ${message}` });
        results.push({ id: call.id, content: message, isError: true });
      }
    }
    msgs.push({ role: 'tool', results });
  }
}
