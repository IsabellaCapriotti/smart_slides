import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express, { type Response } from 'express';
import cors from 'cors';
import { z } from 'zod';
import type { ChatMessage, Deck, Finding, StreamEvent } from '@smart-slides/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

// Imported after dotenv so modules that read env at load time see the values.
const { loadDatasets } = await import('./data');
const { createSession, getSession } = await import('./sessions');
const { generateFindings } = await import('./findings');
const { scaffoldDeck, recommendStyle } = await import('./scaffold');
const { runAgent } = await import('./agent');
const { runFindingsAgent, MAX_FINDINGS, MORE_BATCH } = await import('./findingsAgent');
const { hasApiKey, describeProvider } = await import('./llm');

const app = express();
app.use(cors({ origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/] }));
app.use(express.json({ limit: '60mb' }));

/** Starts an NDJSON stream; returns an emitter. Errors become `error` events, not HTTP failures. */
function startStream(res: Response) {
  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  return (e: StreamEvent) => {
    res.write(`${JSON.stringify(e)}\n`);
  };
}

function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/401|403|authentication|invalid x-api-key|api key not valid|API_KEY_INVALID/i.test(message)) {
    return 'The AI provider rejected the API key. Check the key in your .env file and restart the server.';
  }
  if (/429|quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(message)) {
    return 'The AI provider rate limit was hit (common on free tiers). Wait a minute and try again.';
  }
  return message;
}

async function streamed(res: Response, work: (emit: (e: StreamEvent) => void) => Promise<void>) {
  const emit = startStream(res);
  try {
    await work(emit);
    emit({ type: 'done' });
  } catch (err) {
    console.error(err);
    emit({ type: 'error', message: friendlyError(err) });
  } finally {
    res.end();
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, hasApiKey: hasApiKey(), ...describeProvider() });
});

const FilesBody = z.object({
  files: z.array(z.object({ name: z.string().min(1), csv: z.string() })).min(1),
});

app.post('/api/session', async (req, res) => {
  try {
    const body = FilesBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Send { files: [{ name, csv }] } as JSON.' });
      return;
    }
    const dataset = await loadDatasets(body.data.files);
    const session = createSession(dataset);
    res.json({ sessionId: session.id, profile: dataset.profile });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/findings', async (req, res) => {
  const session = getSession(req.body?.sessionId);
  const more = req.body?.more === true;
  await streamed(res, async (emit) => {
    if (!session) throw new Error('Session expired. Please re-upload your file.');
    const progress = (message: string) => emit({ type: 'progress', message });
    if (!more) {
      session.findings = await generateFindings(session, { onProgress: progress });
    } else {
      const room = MAX_FINDINGS - session.findings.length;
      if (room <= 0) throw new Error(`You already have the maximum of ${MAX_FINDINGS} findings.`);
      const fresh = await generateFindings(session, {
        onProgress: progress,
        count: Math.min(MORE_BATCH, room),
        existing: session.findings,
      });
      if (!fresh.length) {
        throw new Error('No new distinct findings were found this time. Try again in a moment.');
      }
      session.findings = [...session.findings, ...fresh.slice(0, room)];
    }
    emit({ type: 'findings', findings: session.findings });
  });
});

app.post('/api/findings/chat', async (req, res) => {
  const session = getSession(req.body?.sessionId);
  const message = String(req.body?.message ?? '');
  const history = (Array.isArray(req.body?.history) ? req.body.history : []) as ChatMessage[];
  const selectedCount = Number(req.body?.selectedCount) || 0;
  await streamed(res, async (emit) => {
    if (!session) throw new Error('Session expired. Please re-upload your file.');
    await runFindingsAgent({ session, selectedCount, message, history, emit });
  });
});

const StyleBody =z.object({ sessionId: z.string(), findingIds: z.array(z.string()).min(1) });

app.post('/api/style', async (req, res) => {
  const body = StyleBody.safeParse(req.body);
  const session = getSession(req.body?.sessionId);
  await streamed(res, async (emit) => {
    if (!body.success || !session) throw new Error('Session expired. Please re-upload your file.');
    const chosen = session.findings.filter((i) => body.data.findingIds.includes(i.id));
    const rec = await recommendStyle(session, chosen);
    emit({ type: 'style', themeId: rec.themeId, message: rec.message });
  });
});

const ScaffoldBody = z.object({
  sessionId: z.string(),
  findingIds: z.array(z.string()).min(1),
  themeId: z.string(),
});

app.post('/api/scaffold', async (req, res) => {
  const body = ScaffoldBody.safeParse(req.body);
  const session = getSession(req.body?.sessionId);
  await streamed(res, async (emit) => {
    if (!body.success || !session) throw new Error('Session expired. Please re-upload your file.');
    const chosen = body.data.findingIds
      .map((id) => session.findings.find((i) => i.id === id))
      .filter((i): i is Finding => Boolean(i));
    if (!chosen.length) throw new Error('None of the selected findings were found. Please regenerate findings.');
    emit({ type: 'progress', message: 'Designing your slides…' });
    const deck = await scaffoldDeck(session, chosen, body.data.themeId);
    emit({ type: 'deck', deck });
  });
});

app.post('/api/chat', async (req, res) => {
  const session = getSession(req.body?.sessionId);
  const deck = req.body?.deck as Deck | undefined;
  const message = String(req.body?.message ?? '');
  const history = (Array.isArray(req.body?.history) ? req.body.history : []) as ChatMessage[];
  await streamed(res, async (emit) => {
    if (!deck?.slides) throw new Error('No deck was provided.');
    await runAgent({ session, deck, message, history, emit });
  });
});

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => {
  console.log(`Smart Slides server listening on http://localhost:${port}`);
  if (!hasApiKey()) {
    console.warn('\n  ⚠  No LLM API key found. Copy .env.example to .env and add your key.\n');
  }
});
