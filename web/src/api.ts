import type { ChatMessage, DataProfile, Deck, StreamEvent, UploadedFile } from '@smart-slides/shared';

export async function getHealth(): Promise<{ ok: boolean; hasApiKey: boolean; model: string }> {
  const res = await fetch('/api/health');
  if (!res.ok) throw new Error('Backend not reachable');
  return res.json();
}

export async function createSession(files: UploadedFile[]): Promise<{ sessionId: string; profile: DataProfile }> {
  const res = await fetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'Upload failed');
  return body;
}

/** POSTs JSON and invokes `onEvent` for every NDJSON line as it arrives. */
export async function stream(
  path: string,
  body: unknown,
  onEvent: (e: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const flush = (line: string) => {
    if (!line.trim()) return;
    try {
      onEvent(JSON.parse(line) as StreamEvent);
    } catch {
      /* ignore malformed line */
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      flush(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  }
  flush(buf);
}

export type { ChatMessage, Deck };
