import { useRef, useState } from 'react';
import { useStore } from '../store';

export function UploadStep() {
  const { uploadFiles, busy, progress, saved, openSaved, deleteSaved } = useStore();
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const handleFiles = async (list: FileList | File[] | null | undefined) => {
    const all = Array.from(list ?? []);
    if (!all.length) return;
    const csvs = all.filter((f) => /\.csv$/i.test(f.name));
    if (csvs.length !== all.length) {
      useStore.setState({ error: 'Only .csv files are supported in this proof of concept.' });
      return;
    }
    await uploadFiles(await Promise.all(csvs.map(async (f) => ({ name: f.name, csv: await f.text() }))));
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center px-6 py-14 text-center">
      <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-brand shadow-sm ring-1 ring-line">
        Data → findings → slides
      </span>
      <h1 className="mt-5 text-5xl font-extrabold leading-[1.08] tracking-tight">
        Turn a spreadsheet into a <span className="brand-text">story worth presenting</span>
      </h1>
      <p className="mt-4 max-w-xl text-lg text-ink-soft">
        Upload your data and an AI agent will find the trends that matter, then build and refine the slides with you in conversation.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void handleFiles(e.dataTransfer.files);
        }}
        onClick={() => !busy && input.current?.click()}
        className={`mt-10 flex w-full cursor-pointer flex-col items-center rounded-3xl border-2 border-dashed bg-white px-8 py-14 transition ${
          drag ? 'border-brand bg-indigo-50' : 'border-[#cfd2de] hover:border-brand'
        }`}
      >
        <input ref={input} type="file" multiple accept=".csv,text/csv" hidden onChange={(e) => void handleFiles(e.target.files)} />
        {busy ? (
          <>
            <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-brand border-t-transparent" />
            <p className="mt-4 font-medium">{progress || 'Working…'}</p>
          </>
        ) : (
          <>
            <div className="brand-gradient flex h-14 w-14 items-center justify-center rounded-2xl text-white">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 16V4M6 10l6-6 6 6M4 20h16" />
              </svg>
            </div>
            <p className="mt-4 text-lg font-semibold">Drop one or more CSVs here, or click to browse</p>
            <p className="mt-1 text-sm text-ink-soft">Several related files (e.g. customers + orders) are joined automatically. Only aggregated results are sent to the model, never whole files.</p>
          </>
        )}
      </div>

      {saved.length > 0 && !busy && (
        <div className="mt-14 w-full text-left">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Saved decks</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {saved.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-2xl border border-line bg-white p-4">
                <button onClick={() => void openSaved(s)} className="min-w-0 text-left">
                  <div className="truncate font-semibold hover:text-brand">{s.name}</div>
                  <div className="text-xs text-ink-soft">
                    {s.deck.slides.length} slides · {new Date(s.savedAt).toLocaleString()}
                  </div>
                </button>
                <button onClick={() => void deleteSaved(s.id)} className="ml-3 text-xs text-ink-soft hover:text-red-600">
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
