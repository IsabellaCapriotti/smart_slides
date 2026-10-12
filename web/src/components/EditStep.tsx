import { useState } from 'react';
import { useStore } from '../store';
import { exportPptx } from '../export';
import { SlideView } from './SlideView';

export function EditStep() {
  const { deck, activeSlideId, setActiveSlide, undo, redo, past, future, save, busy } = useStore();
  const [exporting, setExporting] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  if (!deck) return null;
  const active = deck.slides.find((s) => s.id === activeSlideId) ?? deck.slides[0];
  const index = deck.slides.indexOf(active);

  const doExport = async () => {
    setExporting(true);
    try {
      await exportPptx(deck);
    } finally {
      setExporting(false);
    }
  };
  const doSave = async () => {
    await save();
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  };

  const btn =
    'rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold transition hover:border-brand hover:text-brand disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink';

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-white px-6 py-3">
        <div className="min-w-0">
          <div className="truncate text-lg font-bold">{deck.title}</div>
          <div className="text-xs text-ink-soft">
            Slide {index + 1} of {deck.slides.length}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button className={btn} onClick={undo} disabled={!past.length || busy}>
            ↶ Undo
          </button>
          <button className={btn} onClick={redo} disabled={!future.length || busy}>
            ↷ Redo
          </button>
          <button className={btn} onClick={() => void doSave()}>
            {savedFlash ? '✓ Saved' : 'Save'}
          </button>
          <button
            onClick={() => void doExport()}
            disabled={exporting}
            className="brand-gradient rounded-full px-5 py-2 text-sm font-semibold text-white shadow-md hover:opacity-90 disabled:opacity-50"
          >
            {exporting ? 'Exporting…' : 'Export .pptx'}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="scroll-thin w-48 shrink-0 space-y-3 overflow-y-auto border-r border-line bg-white p-3">
          {deck.slides.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setActiveSlide(s.id)}
              className={`block w-full rounded-lg p-1 text-left transition ${s.id === active.id ? 'bg-indigo-50 ring-2 ring-brand' : 'hover:bg-canvas'}`}
            >
              <SlideView slide={s} themeId={deck.themeId} className="rounded ring-1 ring-black/10" />
              <div className="mt-1 px-1 text-[11px] font-medium text-ink-soft">{i + 1}</div>
            </button>
          ))}
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-center overflow-auto p-8">
          <div className={`w-full max-w-4xl overflow-hidden rounded-xl shadow-2xl ring-1 ring-black/10 transition ${busy ? 'opacity-90' : ''}`}>
            <SlideView slide={active} themeId={deck.themeId} />
          </div>
        </div>
      </div>
    </div>
  );
}
