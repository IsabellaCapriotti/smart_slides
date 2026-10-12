export const REGIONS = ['header', 'left', 'right', 'main', 'footer'] as const;
export type Region = (typeof REGIONS)[number];

export const LAYOUTS = ['title', 'split', 'split-flipped', 'full'] as const;
export type LayoutId = (typeof LAYOUTS)[number];

export const CHART_TYPES = ['bar', 'stacked-bar', 'line', 'area', 'pie', 'scatter'] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export type Row = Record<string, string | number | null>;

interface ElementBase {
  id: string;
  region: Region;
}

export interface TitleElement extends ElementBase {
  type: 'title';
  text: string;
}
export interface SubtitleElement extends ElementBase {
  type: 'subtitle';
  text: string;
}
export interface BulletsElement extends ElementBase {
  type: 'bullets';
  items: string[];
}
export interface TextElement extends ElementBase {
  type: 'text';
  text: string;
}
export interface StatElement extends ElementBase {
  type: 'stat';
  value: string;
  label: string;
}
export interface ChartElement extends ElementBase {
  type: 'chart';
  chartType: ChartType;
  title?: string;
  xKey: string;
  yKeys: string[];
  xLabel?: string;
  yLabel?: string;
  data: Row[];
  /** Query that produced `data` (kept for provenance and re-running). */
  sql?: string;
}

export type SlideElement =
  | TitleElement
  | SubtitleElement
  | BulletsElement
  | TextElement
  | StatElement
  | ChartElement;

export interface Slide {
  id: string;
  layout: LayoutId;
  elements: SlideElement[];
}

export interface Deck {
  title: string;
  themeId: string;
  slides: Slide[];
}

export interface ChartSpec {
  chartType: ChartType;
  xKey: string;
  yKeys: string[];
  xLabel?: string;
  yLabel?: string;
  data: Row[];
}

export interface KeyFigure {
  value: string;
  label: string;
}

export interface Finding {
  id: string;
  headline: string;
  narrative: string;
  keyFigures: KeyFigure[];
  chart: ChartSpec;
  sql: string;
  significance: number;
}

export interface ColumnProfile {
  name: string;
  type: 'number' | 'date' | 'text';
  nulls: number;
  distinct: number;
  min?: number | string;
  max?: number | string;
  mean?: number;
  median?: number;
  topValues?: { value: string; count: number }[];
}

export interface TableProfile {
  /** SQL table name (derived from the file name). */
  name: string;
  fileName: string;
  rowCount: number;
  columns: ColumnProfile[];
  sampleRows: Row[];
}

/** A detected join path: `fromTable.fromColumn` values are found in `toTable.toColumn`. */
export interface Relationship {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  /** % of distinct non-null `from` values that exist in `to`. */
  coveragePct: number;
  /** True when `toColumn` is unique (so the join is many-to-one, not fan-out). */
  toUnique: boolean;
}

export interface DataProfile {
  /** Comma-separated file names, for display. */
  fileName: string;
  /** Total rows across all tables. */
  rowCount: number;
  tables: TableProfile[];
  relationships: Relationship[];
  /** Non-fatal notices to show the user, e.g. truncated uploads. */
  warnings: string[];
}

export interface UploadedFile {
  name: string;
  csv: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Newline-delimited JSON events streamed from the server. */
export type StreamEvent =
  | { type: 'progress'; message: string }
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; summary: string }
  | { type: 'deck'; deck: Deck }
  /** `replaced` means the list was regenerated from scratch (the client should clear its selection). */
  | { type: 'findings'; findings: Finding[]; replaced?: boolean }
  | { type: 'style'; themeId: string; message: string }
  | { type: 'done' }
  | { type: 'error'; message: string };
