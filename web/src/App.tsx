import { useEffect, useState } from 'react';
import { useStore, type Step } from './store';
import { AgentPanel } from './components/AgentPanel';
import { UploadStep } from './components/UploadStep';
import { FindingsStep } from './components/FindingsStep';
import { StyleStep } from './components/StyleStep';
import { EditStep } from './components/EditStep';

const STEPS: { id: Step; label: string }[] = [
  { id: 'upload', label: 'Upload' },
  { id: 'findings', label: 'Findings' },
  { id: 'style', label: 'Style' },
  { id: 'edit', label: 'Refine & export' },
];

function Stepper({ step }: { step: Step }) {
  const current = STEPS.findIndex((s) => s.id === (step === 'building' ? 'style' : step));
  return (
    <ol className="hidden items-center gap-2 md:flex">
      {STEPS.map((s, i) => (
        <li key={s.id} className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
              i < current ? 'bg-brand text-white' : i === current ? 'brand-gradient text-white' : 'bg-[#e6e7ec] text-ink-soft'
            }`}
          >
            {i < current ? '✓' : i + 1}
          </span>
          <span className={`text-sm ${i === current ? 'font-semibold' : 'text-ink-soft'}`}>{s.label}</span>
          {i < STEPS.length - 1 && <span className="mx-1 h-px w-8 bg-line" />}
        </li>
      ))}
    </ol>
  );
}

export function App() {
  const { step, init, error, health, reset, profile, sessionId } = useStore();
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const warnings = profile?.warnings ?? [];

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-white px-6">
        <button onClick={reset} className="flex items-center gap-2.5">
          <span className="brand-gradient flex h-8 w-8 items-center justify-center rounded-lg text-sm font-black text-white">S</span>
          <span className="text-base font-bold tracking-tight">Smart Slides</span>
        </button>
        <Stepper step={step} />
        <span className="w-24" />
      </header>

      {health && !health.hasApiKey && (
        <div className="shrink-0 bg-amber-50 px-6 py-2.5 text-sm text-amber-900 ring-1 ring-amber-200">
          <strong>No LLM API key configured.</strong> Copy <code>.env.example</code> to <code>.env</code>, add your key (e.g.{' '}
          <code>GEMINI_API_KEY</code>), and restart <code>npm run dev</code>.
        </div>
      )}
      {warnings.length > 0 && dismissedFor !== sessionId && (
        <div className="flex shrink-0 items-start justify-between bg-amber-50 px-6 py-2.5 text-sm text-amber-900 ring-1 ring-amber-200">
          <div>
            {warnings.map((w, i) => (
              <div key={i}>
                <strong>Heads up:</strong> {w}
              </div>
            ))}
          </div>
          <button onClick={() => setDismissedFor(sessionId)} className="ml-4 shrink-0 font-semibold hover:underline">
            Dismiss
          </button>
        </div>
      )}
      {error && (
        <div className="flex shrink-0 items-center justify-between bg-red-50 px-6 py-2.5 text-sm text-red-800 ring-1 ring-red-200">
          <span>{error}</span>
          <button onClick={() => useStore.setState({ error: null })} className="ml-4 font-semibold hover:underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <main className="scroll-thin min-w-0 flex-1 overflow-y-auto">
          {step === 'upload' && <UploadStep />}
          {step === 'findings' && <FindingsStep />}
          {step === 'style' && <StyleStep />}
          {step === 'building' && (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <span className="h-10 w-10 animate-spin rounded-full border-[3px] border-brand border-t-transparent" />
              <div className="text-xl font-bold">Building your presentation…</div>
              <p className="text-ink-soft">Writing slide copy and assembling charts.</p>
            </div>
          )}
          {step === 'edit' && <EditStep />}
        </main>
        {step !== 'upload' && <AgentPanel />}
      </div>
    </div>
  );
}
