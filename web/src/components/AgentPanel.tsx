import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

const SUGGESTIONS = [
  'Make the chart on slide 2 a line chart',
  'Add a slide comparing countries',
  'Move the chart to the right side',
  'Switch to the Aurora theme',
];

const FINDING_SUGGESTIONS = [
  'Find more findings',
  'Look for differences between segments',
  'Anything surprising over time?',
  'Regenerate with a focus on outliers',
];

function renderInline(text: string) {
  // Minimal **bold** support for agent messages.
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>,
  );
}

export function AgentPanel() {
  const { messages, busy, progress, step, sendChat } = useStore();
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const canChat = step === 'edit' || step === 'findings';
  const suggestions = step === 'findings' ? FINDING_SUGGESTIONS : SUGGESTIONS;
  // On the findings step the setup messages are already in the thread, so key off the user's own messages.
  const showSuggestions =
    canChat && (step === 'findings' ? !messages.some((m) => m.role === 'user') : messages.length <= 1);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, progress]);

  const submit = () => {
    const t = text.trim();
    if (!t || busy || !canChat) return;
    setText('');
    void sendChat(t);
  };

  return (
    <aside className="flex h-full w-[380px] shrink-0 flex-col border-l border-line bg-white">
      <div className="flex items-center gap-3 border-b border-line px-5 py-4">
        <div className="brand-gradient flex h-9 w-9 items-center justify-center rounded-full text-white">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l1.9 5.6L19.5 9l-5.6 1.9L12 16.5l-1.9-5.6L4.5 9l5.6-1.4L12 2zm6 12l.9 2.6L21.5 17l-2.6.9L18 20.5l-.9-2.6L14.5 17l2.6-.4L18 14z" />
          </svg>
        </div>
        <div>
          <div className="text-sm font-semibold">Slide agent</div>
          <div className="text-xs text-ink-soft">{busy ? 'Working…' : step === 'findings' ? 'Ask for the findings you want' : canChat ? 'Ask me to change anything' : 'Guiding your setup'}</div>
        </div>
      </div>

      <div className="scroll-thin flex-1 space-y-4 overflow-y-auto px-5 py-5">
        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex'}>
            <div
              className={
                m.role === 'user'
                  ? 'max-w-[85%] rounded-2xl rounded-br-md bg-brand px-4 py-2.5 text-sm text-white'
                  : `max-w-[92%] rounded-2xl rounded-bl-md px-4 py-2.5 text-sm ${m.error ? 'bg-red-50 text-red-700' : 'bg-canvas text-ink'}`
              }
            >
              {m.actions && m.actions.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {m.actions.map((a, i) => (
                    <span key={i} className="rounded-full border border-line bg-white px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                      ✓ {a}
                    </span>
                  ))}
                </div>
              )}
              {m.content ? (
                <div className="whitespace-pre-wrap leading-relaxed">{renderInline(m.content)}</div>
              ) : (
                <div className="flex gap-1 py-1">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-soft/60" style={{ animationDelay: `${i * 120}ms` }} />
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && progress && step !== 'edit' && (
          <div className="flex items-center gap-2 text-xs text-ink-soft">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand border-t-transparent" />
            {progress}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-line p-4">
        {showSuggestions && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s}
                disabled={busy}
                onClick={() => void sendChat(s)}
                className="rounded-full border border-line px-3 py-1 text-xs text-ink-soft transition hover:border-brand hover:text-brand disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div className={`flex items-end gap-2 rounded-2xl border bg-white px-3 py-2 ${canChat ? 'border-line focus-within:border-brand' : 'border-line bg-canvas'}`}>
          <textarea
            rows={1}
            value={text}
            disabled={!canChat || busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={canChat ? (step === 'findings' ? 'Ask for a kind of finding, or “generate more”…' : 'Describe a change…') : 'Complete the current step to start chatting'}
            className="max-h-32 min-h-[28px] flex-1 resize-none bg-transparent py-1 text-sm outline-none placeholder:text-ink-soft/70"
          />
          <button
            onClick={submit}
            disabled={!canChat || busy || !text.trim()}
            className="brand-gradient flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white transition disabled:opacity-40"
            aria-label="Send"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}
