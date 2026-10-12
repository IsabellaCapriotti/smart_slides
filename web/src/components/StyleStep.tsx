import { THEMES, uid, type Slide } from '@smart-slides/shared';
import { useStore } from '../store';
import { SlideView } from './SlideView';

const PREVIEW: Slide = {
  id: 'preview',
  layout: 'split',
  elements: [
    { id: uid(), type: 'title', region: 'header', text: 'Engagement is climbing fast' },
    {
      id: uid(),
      type: 'chart',
      region: 'left',
      chartType: 'bar',
      xKey: 'q',
      yKeys: ['a', 'b'],
      data: [
        { q: 'Q1', a: 30, b: 18 },
        { q: 'Q2', a: 44, b: 26 },
        { q: 'Q3', a: 38, b: 41 },
        { q: 'Q4', a: 62, b: 48 },
      ],
    },
    { id: uid(), type: 'stat', region: 'right', value: '+42%', label: 'year over year' },
    { id: uid(), type: 'bullets', region: 'right', items: ['Clear takeaway', 'Supporting point'] },
  ],
};

export function StyleStep() {
  const { themeId, setTheme, recommendedThemeId, buildDeck, busy, progress } = useStore();

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <h2 className="text-2xl font-bold">Choose a look</h2>
      <p className="mt-1 text-ink-soft">You can change this any time by asking the agent.</p>
      {busy && <p className="mt-2 text-sm text-ink-soft">{progress}</p>}

      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {THEMES.map((t) => {
          const on = t.id === themeId;
          return (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={`relative rounded-2xl border-2 bg-white p-3 text-left transition ${
                on ? 'border-brand shadow-lg shadow-indigo-100' : 'border-transparent shadow-sm ring-1 ring-line hover:ring-brand/50'
              }`}
            >
              {t.id === recommendedThemeId && (
                <span className="brand-gradient absolute -top-2.5 left-4 rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white">
                  Recommended
                </span>
              )}
              <SlideView slide={PREVIEW} themeId={t.id} className="rounded-lg ring-1 ring-black/5" />
              <div className="mt-3 px-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{t.name}</span>
                  <span className="flex gap-1">
                    {t.palette.slice(0, 4).map((c) => (
                      <span key={c} className="h-3 w-3 rounded-full" style={{ background: c }} />
                    ))}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-soft">{t.description}</p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="sticky bottom-0 -mx-8 mt-8 flex justify-end border-t border-line bg-canvas/90 px-8 py-4 backdrop-blur">
        <button
          onClick={() => void buildDeck()}
          disabled={busy}
          className="brand-gradient rounded-full px-6 py-2.5 text-sm font-semibold text-white shadow-md transition hover:opacity-90 disabled:opacity-40"
        >
          Build my presentation →
        </button>
      </div>
    </div>
  );
}
