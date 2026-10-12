import { create } from 'zustand';
import {
  DEFAULT_THEME_ID,
  type ChatMessage,
  type DataProfile,
  type Deck,
  type Finding,
  type UploadedFile,
} from '@smart-slides/shared';
import * as api from './api';
import { listSaved, removeSaved, saveDeck, type SavedDeck } from './persist';

export type Step = 'upload' | 'findings' | 'style' | 'building' | 'edit';

export interface UiMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  /** Short chips describing tool actions taken during this reply. */
  actions?: string[];
  error?: boolean;
}

interface State {
  step: Step;
  busy: boolean;
  progress: string;
  error: string | null;
  health: { hasApiKey: boolean; model: string } | null;

  files: UploadedFile[];
  sessionId: string | null;
  profile: DataProfile | null;

  findings: Finding[];
  selectedIds: string[];
  themeId: string;
  recommendedThemeId: string | null;

  deck: Deck | null;
  past: Deck[];
  future: Deck[];
  activeSlideId: string | null;
  deckId: string;
  saved: SavedDeck[];

  messages: UiMessage[];

  init(): Promise<void>;
  uploadFiles(files: UploadedFile[]): Promise<void>;
  generateFindings(more?: boolean): Promise<void>;
  toggleFinding(id: string): void;
  continueToStyle(): Promise<void>;
  setTheme(id: string): void;
  buildDeck(): Promise<void>;
  sendChat(text: string): Promise<void>;
  setActiveSlide(id: string): void;
  undo(): void;
  redo(): void;
  save(): Promise<void>;
  openSaved(entry: SavedDeck): Promise<void>;
  deleteSaved(id: string): Promise<void>;
  reset(): void;
}

let msgId = 0;
const nextId = () => ++msgId;

const initial = {
  step: 'upload' as Step,
  busy: false,
  progress: '',
  error: null,
  files: [] as UploadedFile[],
  sessionId: null,
  profile: null,
  findings: [] as Finding[],
  selectedIds: [] as string[],
  themeId: DEFAULT_THEME_ID,
  recommendedThemeId: null,
  deck: null,
  past: [] as Deck[],
  future: [] as Deck[],
  activeSlideId: null,
  messages: [] as UiMessage[],
};

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useStore = create<State>((set, get) => {
  const say = (content: string, extra: Partial<UiMessage> = {}) =>
    set((s) => ({ messages: [...s.messages, { id: nextId(), role: 'assistant', content, ...extra }] }));

  /** Runs a streaming request, surfacing progress and errors uniformly. */
  const run = async (path: string, body: unknown, handlers: (e: import('@smart-slides/shared').StreamEvent) => void) => {
    let failure: string | null = null;
    await api.stream(path, body, (e) => {
      if (e.type === 'progress') set({ progress: e.message });
      if (e.type === 'error') failure = e.message;
      handlers(e);
    });
    if (failure) throw new Error(failure);
  };

  return {
    ...initial,
    health: null,
    deckId: crypto.randomUUID(),
    saved: [],

    async init() {
      set({ saved: await listSaved() });
      try {
        const h = await api.getHealth();
        set({ health: { hasApiKey: h.hasApiKey, model: h.model } });
      } catch {
        set({ error: 'Cannot reach the backend on port 8787. Is `npm run dev` running?' });
      }
    },

    async uploadFiles(files) {
      set({ busy: true, error: null, progress: files.length > 1 ? 'Reading your files…' : 'Reading your file…' });
      try {
        const { sessionId, profile } = await api.createSession(files);
        set({ files, sessionId, profile, step: 'findings', findings: [], selectedIds: [], messages: [] });
        const tables = profile.tables.length;
        const links = profile.relationships.length;
        say(
          tables === 1
            ? `Got it — **${profile.fileName}** has ${profile.rowCount.toLocaleString()} rows and ${profile.tables[0].columns.length} columns. `
            : `Got it — ${tables} tables (${profile.tables.map((t) => `**${t.name}**`).join(', ')}), ${profile.rowCount.toLocaleString()} rows in total. ` +
                (links
                  ? `I found ${links} link${links === 1 ? '' : 's'} between them (${profile.relationships
                      .map((r) => `${r.fromTable}.${r.fromColumn} → ${r.toTable}.${r.toColumn}`)
                      .join(', ')}), so I can look for patterns across tables. `
                  : `I didn't find any shared keys between them, so I'll analyze them separately. `),
        );
        say('Give me a moment while I look for the trends worth presenting.');
        await get().generateFindings();
      } catch (e) {
        set({ error: errMsg(e), busy: false });
      }
    },

    async generateFindings(more = false) {
      const { sessionId } = get();
      set({ busy: true, error: null, progress: more ? 'Looking for more…' : 'Analyzing…' });
      try {
        await run('/api/findings', { sessionId, more }, (e) => {
          if (e.type === 'findings') {
            const before = get().findings.length;
            set((s) => ({
              findings: e.findings,
              // Keep the user's selections when adding more; reset them on a full regenerate.
              selectedIds: more ? s.selectedIds.filter((id) => e.findings.some((i) => i.id === id)) : [],
            }));
            say(
              more
                ? `Added ${e.findings.length - before} more finding${e.findings.length - before === 1 ? '' : 's'} (${e.findings.length} total). Your earlier selections are kept.`
                : `I found ${e.findings.length} findings that stand out. Each one is backed by a query against your data. ` +
                    `Pick the ones you want to build slides around.`,
            );
          }
        });
      } catch (e) {
        set({ error: errMsg(e) });
      } finally {
        set({ busy: false, progress: '' });
      }
    },

    toggleFinding(id) {
      set((s) => ({
        selectedIds: s.selectedIds.includes(id) ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id],
      }));
    },

    async continueToStyle() {
      const { sessionId, selectedIds } = get();
      set({ busy: true, error: null, step: 'style', progress: 'Thinking about style…', recommendedThemeId: null });
      say(`Great, ${selectedIds.length} finding${selectedIds.length === 1 ? '' : 's'} selected. Now let's choose a look.`);
      try {
        await run('/api/style', { sessionId, findingIds: selectedIds }, (e) => {
          if (e.type === 'style') {
            set({ recommendedThemeId: e.themeId, themeId: e.themeId });
            say(e.message);
          }
        });
      } catch (e) {
        say('Pick any style below — you can change it later by asking me.');
        set({ error: null });
        console.warn(e);
      } finally {
        set({ busy: false, progress: '' });
      }
    },

    setTheme(id) {
      set({ themeId: id });
    },

    async buildDeck() {
      const { sessionId, selectedIds, themeId } = get();
      set({ busy: true, error: null, step: 'building', progress: 'Designing your slides…' });
      try {
        await run('/api/scaffold', { sessionId, findingIds: selectedIds, themeId }, (e) => {
          if (e.type === 'deck') {
            set({ deck: e.deck, past: [], future: [], activeSlideId: e.deck.slides[0]?.id ?? null, step: 'edit' });
            say(
              `Your deck is ready: ${e.deck.slides.length} slides. Tell me what to change — for example, ` +
                `“make the chart on slide 2 a line chart”, “move the chart to the right”, or “add a slide comparing countries”.`,
            );
          }
        });
        if (get().step !== 'edit') throw new Error('The deck could not be generated.');
      } catch (e) {
        set({ error: errMsg(e), step: 'style' });
      } finally {
        set({ busy: false, progress: '' });
      }
    },

    async sendChat(text) {
      const { deck, sessionId, messages, step, selectedIds } = get();
      // On the findings step the same chat box steers finding generation instead of editing a deck.
      const onFindings = step === 'findings';
      if (!text.trim() || (onFindings ? !sessionId : !deck)) return;
      const history: ChatMessage[] = messages
        .filter((m) => !m.error)
        .map((m) => ({ role: m.role, content: m.content }));
      const replyId = nextId();
      set((s) => ({
        busy: true,
        error: null,
        messages: [
          ...s.messages,
          { id: nextId(), role: 'user', content: text },
          { id: replyId, role: 'assistant', content: '', actions: [] },
        ],
      }));
      const patch = (fn: (m: UiMessage) => UiMessage) =>
        set((s) => ({ messages: s.messages.map((m) => (m.id === replyId ? fn(m) : m)) }));
      let changed = false;
      try {
        const [path, body] = onFindings
          ? ['/api/findings/chat', { sessionId, message: text, history, selectedCount: selectedIds.length }]
          : ['/api/chat', { sessionId, deck, message: text, history }];
        await run(path, body, (e) => {
          if (e.type === 'text') patch((m) => ({ ...m, content: m.content + e.delta }));
          if (e.type === 'tool') patch((m) => ({ ...m, actions: [...(m.actions ?? []), e.summary] }));
          if (onFindings && e.type === 'findings') {
            set((s) => ({
              findings: e.findings,
              // Added findings keep the user's picks; a full regenerate starts clean.
              selectedIds: e.replaced ? [] : s.selectedIds.filter((id) => e.findings.some((f) => f.id === id)),
            }));
          }
          if (e.type === 'deck') {
            const isFirstChange = !changed;
            changed = true;
            set((s) => {
              const keepActive = s.activeSlideId && e.deck.slides.some((x) => x.id === s.activeSlideId);
              return {
                // Only the first change of a turn pushes history, so one prompt == one undo step.
                past: isFirstChange && s.deck ? [...s.past, s.deck] : s.past,
                future: [],
                deck: e.deck,
                activeSlideId: keepActive ? s.activeSlideId : (e.deck.slides[e.deck.slides.length - 1]?.id ?? null),
              };
            });
          }
        });
      } catch (e) {
        patch((m) => ({ ...m, content: m.content || errMsg(e), error: true }));
      } finally {
        patch((m) => (m.content || m.actions?.length ? m : { ...m, content: 'Done.' }));
        set({ busy: false });
      }
    },

    setActiveSlide(id) {
      set({ activeSlideId: id });
    },

    undo() {
      const { past, deck, future } = get();
      if (!past.length || !deck) return;
      const prev = past[past.length - 1];
      set({
        deck: prev,
        past: past.slice(0, -1),
        future: [deck, ...future],
        activeSlideId: prev.slides.some((s) => s.id === get().activeSlideId) ? get().activeSlideId : prev.slides[0]?.id ?? null,
      });
    },

    redo() {
      const { past, deck, future } = get();
      if (!future.length || !deck) return;
      const next = future[0];
      set({ deck: next, past: [...past, deck], future: future.slice(1) });
    },

    async save() {
      const { deck, deckId, files } = get();
      if (!deck) return;
      await saveDeck({ id: deckId, name: deck.title, savedAt: Date.now(), deck, files });
      set({ saved: await listSaved() });
    },

    async openSaved(entry) {
      set({ ...initial, busy: true, progress: 'Opening saved deck…', deckId: entry.id });
      let sessionId: string | null = null;
      let profile: DataProfile | null = null;
      const files: UploadedFile[] = entry.files ?? (entry.csv ? [{ name: entry.fileName ?? 'data.csv', csv: entry.csv }] : []);
      if (files.length) {
        try {
          ({ sessionId, profile } = await api.createSession(files));
        } catch {
          /* deck is still viewable; the agent just won't be able to query data */
        }
      }
      set({
        busy: false,
        progress: '',
        step: 'edit',
        deck: entry.deck,
        themeId: entry.deck.themeId,
        activeSlideId: entry.deck.slides[0]?.id ?? null,
        sessionId,
        profile,
        files,
        messages: [
          {
            id: nextId(),
            role: 'assistant',
            content: sessionId
              ? `Welcome back! I've reloaded “${entry.name}” along with its data. What would you like to change?`
              : `I've reopened “${entry.name}”. The original data isn't available, so I can edit text, layout and theme but not re-query charts.`,
          },
        ],
      });
    },

    async deleteSaved(id) {
      await removeSaved(id);
      set({ saved: await listSaved() });
    },

    reset() {
      set({ ...initial, deckId: crypto.randomUUID() });
    },
  };
});
