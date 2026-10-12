import { useMemo } from 'react';
import { uid, type Insight, type Slide } from '@smart-slides/shared';
import { useStore } from '../store';
import { SlideView } from './SlideView';

const MAX_INSIGHTS = 30;

function InsightPreview({ insight }: { insight: Insight }) {
  const slide: Slide = useMemo(
    () => ({
      id: insight.id,
      layout: 'full',
      elements: [{ id: uid(), type: 'chart', region: 'main', ...insight.chart }],
    }),
    [insight],
  );
  return <SlideView slide={slide} themeId="ocean" className="rounded-xl border border-line" />;
}

export function InsightsStep() {
  const { insights, selectedIds, toggleInsight, continueToStyle, busy, progress, generateInsights, profile } = useStore();
  const atCap = insights.length >= MAX_INSIGHTS;

  if (busy && !insights.length) {
    return (
      <div className="mx-auto max-w-5xl px-8 py-10">
        <h2 className="text-2xl font-bold">Analyzing your data…</h2>
        <p className="mt-1 text-ink-soft">{progress}</p>
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="shimmer h-64 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">What stands out in {profile?.fileName}</h2>
          <p className="mt-1 text-ink-soft">Select the insights you want to present. Each is verified against your data.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-soft">
            {insights.length}/{MAX_INSIGHTS}
          </span>
          <button
            onClick={() => void generateInsights(true)}
            disabled={busy || atCap}
            title={atCap ? `Maximum of ${MAX_INSIGHTS} insights reached` : 'Keep these and find more'}
            className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold hover:border-brand hover:text-brand disabled:opacity-50"
          >
            {busy ? 'Working…' : atCap ? 'Max reached' : 'Generate more'}
          </button>
          <button
            onClick={() => {
              if (selectedIds.length === 0 || window.confirm('Regenerating replaces all current insights and clears your selection. Continue?')) {
                void generateInsights(false);
              }
            }}
            disabled={busy}
            className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold hover:border-brand hover:text-brand disabled:opacity-50"
          >
            Regenerate
          </button>
        </div>
      </div>

      {busy && progress && <p className="mt-3 text-sm text-ink-soft">{progress}</p>}

      <div className="mt-8 grid gap-5 md:grid-cols-2">
        {insights.map((ins) => {
          const on = selectedIds.includes(ins.id);
          return (
            <button
              key={ins.id}
              onClick={() => toggleInsight(ins.id)}
              className={`group flex flex-col rounded-2xl border-2 bg-white p-4 text-left transition ${
                on ? 'border-brand shadow-lg shadow-indigo-100' : 'border-transparent shadow-sm ring-1 ring-line hover:ring-brand/50'
              }`}
            >
              <InsightPreview insight={ins} />
              <div className="mt-4 flex items-start gap-3">
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[11px] text-white ${
                    on ? 'border-brand bg-brand' : 'border-[#c4c7d4]'
                  }`}
                >
                  {on && '✓'}
                </span>
                <div>
                  <div className="font-semibold leading-snug">{ins.headline}</div>
                  <p className="mt-1 text-sm text-ink-soft">{ins.narrative}</p>
                  {ins.keyFigures.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {ins.keyFigures.map((k, i) => (
                        <span key={i} className="rounded-lg bg-canvas px-2.5 py-1 text-xs">
                          <span className="font-bold text-brand">{k.value}</span> <span className="text-ink-soft">{k.label}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="sticky bottom-0 -mx-8 mt-8 flex items-center justify-between border-t border-line bg-canvas/90 px-8 py-4 backdrop-blur">
        <span className="text-sm text-ink-soft">{selectedIds.length} selected</span>
        <button
          onClick={() => void continueToStyle()}
          disabled={!selectedIds.length || busy}
          className="brand-gradient rounded-full px-6 py-2.5 text-sm font-semibold text-white shadow-md transition hover:opacity-90 disabled:opacity-40"
        >
          Continue to style →
        </button>
      </div>
    </div>
  );
}
