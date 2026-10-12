import { useMemo, useState } from 'react';
import { uid, type Finding, type Slide } from '@smart-slides/shared';
import { useStore } from '../store';
import { SlideView } from './SlideView';

const MAX_FINDINGS = 30;

function FindingPreview({ finding }: { finding: Finding }) {
  const slide: Slide = useMemo(
    () => ({
      id: finding.id,
      layout: 'full',
      elements: [{ id: uid(), type: 'chart', region: 'main', ...finding.chart }],
    }),
    [finding],
  );
  return <SlideView slide={slide} themeId="ocean" className="rounded-xl border border-line" />;
}

export function FindingsStep() {
  const { findings, selectedIds, toggleFinding, continueToStyle, busy, progress, generateFindings, profile } = useStore();
  const atCap = findings.length >= MAX_FINDINGS;
  const [openSql, setOpenSql] = useState<Set<string>>(new Set());
  const toggleSql = (id: string) =>
    setOpenSql((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (busy && !findings.length) {
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
          <p className="mt-1 text-ink-soft">Select the findings you want to present. Each is verified against your data.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-soft">
            {findings.length}/{MAX_FINDINGS}
          </span>
          <button
            onClick={() => void generateFindings(true)}
            disabled={busy || atCap}
            title={atCap ? `Maximum of ${MAX_FINDINGS} findings reached` : 'Keep these and find more'}
            className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold hover:border-brand hover:text-brand disabled:opacity-50"
          >
            {busy ? 'Working…' : atCap ? 'Max reached' : 'Generate more'}
          </button>
          <button
            onClick={() => {
              if (selectedIds.length === 0 || window.confirm('Regenerating replaces all current findings and clears your selection. Continue?')) {
                void generateFindings(false);
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
        {findings.map((ins) => {
          const on = selectedIds.includes(ins.id);
          return (
            <div
              key={ins.id}
              className={`flex flex-col rounded-2xl border-2 bg-white p-4 text-left transition ${
                on ? 'border-brand shadow-lg shadow-indigo-100' : 'border-transparent shadow-sm ring-1 ring-line hover:ring-brand/50'
              }`}
            >
              <button onClick={() => toggleFinding(ins.id)} className="flex flex-col text-left">
              <FindingPreview finding={ins} />
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
              <div className="mt-3 border-t border-line pt-3">
                <button
                  onClick={() => toggleSql(ins.id)}
                  className="text-xs font-semibold text-ink-soft hover:text-brand"
                  aria-expanded={openSql.has(ins.id)}
                >
                  {openSql.has(ins.id) ? '▾ Hide SQL' : '▸ View SQL'}
                </button>
                {openSql.has(ins.id) && (
                  <div className="relative mt-2">
                    <pre className="scroll-thin max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[#14151f] p-3 pr-16 font-mono text-xs leading-relaxed text-[#e6e7f2]">
                      {ins.sql}
                    </pre>
                    <button
                      onClick={() => void navigator.clipboard?.writeText(ins.sql)}
                      className="absolute right-2 top-2 rounded-md bg-white/10 px-2 py-1 text-[11px] font-medium text-white hover:bg-white/20"
                    >
                      Copy
                    </button>
                    <p className="mt-1.5 text-[11px] text-ink-soft">
                      Exact query the model wrote and that produced this chart. It is cached and reused as-is for your slides.
                    </p>
                  </div>
                )}
              </div>
            </div>
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
