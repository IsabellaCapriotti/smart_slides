import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { z } from 'zod';

/** Provider-neutral conversation format used by the agent loop. */
export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  /** Provider-specific metadata that must be echoed back (e.g. Gemini thought signatures). */
  extra?: unknown;
}
export type Msg =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; results: { id: string; content: string; isError?: boolean }[] };

export interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodType;
}

interface Provider {
  label: string;
  model: string;
  /** Forces a single tool call and returns its raw (unvalidated) arguments. */
  forceTool(o: { system: string; user: string; tool: ToolDef; maxTokens: number }): Promise<unknown>;
  /** One assistant turn with tools available. Text is reported via onText. */
  chat(o: {
    system: string;
    tools: ToolDef[];
    messages: Msg[];
    maxTokens: number;
    onText: (delta: string) => void;
  }): Promise<{ text: string; toolCalls: ToolCall[] }>;
}

function rawSchema(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

/**
 * Gemini's OpenAI-compatible endpoint accepts only an OpenAPI-style subset of JSON Schema,
 * so strip/rewrite keywords it rejects. Harmless for other OpenAI-compatible providers.
 */
function simplifySchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(simplifySchema);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === 'additionalProperties' || k === 'propertyNames' || k === '$schema' || k === 'exclusiveMinimum' || k === 'exclusiveMaximum') continue;
    if (k === 'const') {
      out.enum = [v];
      continue;
    }
    if (k === 'oneOf') {
      out.anyOf = simplifySchema(v);
      continue;
    }
    out[k] = simplifySchema(v);
  }
  return out;
}

// ---------------------------------------------------------------- Anthropic

function anthropicProvider(): Provider {
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const toTool = (t: ToolDef): Anthropic.Tool => ({
    name: t.name,
    description: t.description,
    input_schema: rawSchema(t.schema) as unknown as Anthropic.Tool.InputSchema,
  });

  return {
    label: 'Anthropic',
    model,
    async forceTool({ system, user, tool, maxTokens }) {
      const res = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        tools: [toTool(tool)],
        tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content: user }],
      });
      return res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')?.input;
    },
    async chat({ system, tools, messages, maxTokens, onText }) {
      const params: Anthropic.MessageParam[] = messages.map((m) => {
        if (m.role === 'user') return { role: 'user', content: m.content };
        if (m.role === 'assistant') {
          const blocks: Anthropic.ContentBlockParam[] = [];
          if (m.content) blocks.push({ type: 'text', text: m.content });
          for (const c of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
          return { role: 'assistant', content: blocks };
        }
        return {
          role: 'user',
          content: m.results.map((r) => ({ type: 'tool_result' as const, tool_use_id: r.id, content: r.content, is_error: r.isError })),
        };
      });
      const stream = client.messages.stream({ model, max_tokens: maxTokens, system, tools: tools.map(toTool), messages: params });
      stream.on('text', onText);
      const final = await stream.finalMessage();
      return {
        text: final.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join(''),
        toolCalls: final.content
          .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
          .map((b) => ({ id: b.id, name: b.name, input: b.input })),
      };
    },
  };
}

// ------------------------------------------------- OpenAI-compatible (Gemini etc.)

/**
 * Gemini returns errors as a JSON *array* (`[{"error": {...}}]`), which the OpenAI SDK cannot parse,
 * leaving only "404 status code (no body)". Unwrap it so real messages reach the UI.
 */
const unwrapErrorFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  if (res.ok) return res;
  const text = await res.text();
  let body = text;
  try {
    const j = JSON.parse(text);
    if (Array.isArray(j) && j[0]?.error) body = JSON.stringify(j[0]);
  } catch {
    /* keep raw text */
  }
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
};

/** Free tiers allow only a handful of requests per minute; wait out the server-provided delay and retry. */
async function withRateLimitRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const e = err as { status?: number; error?: { details?: { retryDelay?: string }[] } };
      const transient = e.status === 503 || e.status === 500;
      if ((e.status !== 429 && !transient) || i >= attempts - 1) throw err;
      const hinted = e.error?.details?.find((d) => d.retryDelay)?.retryDelay;
      const seconds = transient ? 4 * (i + 1) : hinted ? parseFloat(hinted) : 20;
      const waitMs = Math.min(60, (Number.isFinite(seconds) ? seconds : 20) + (transient ? 0 : 2)) * 1000;
      console.warn(`Provider returned ${e.status}; waiting ${Math.round(waitMs / 1000)}s before retrying…`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

function openAiCompatibleProvider(cfg: {
  label: string;
  baseURL: string;
  apiKey: string;
  model: string;
  /** Thinking models spend output tokens on reasoning; give them headroom and keep it short. */
  thinking?: boolean;
}): Provider {
  const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, maxRetries: 1, fetch: unwrapErrorFetch });
  const extraParams = cfg.thinking ? { reasoning_effort: 'low' as const } : {};
  const budget = (n: number) => (cfg.thinking ? n + 4096 : n);
  const toTool = (t: ToolDef): OpenAI.Chat.ChatCompletionTool => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: simplifySchema(rawSchema(t.schema)) as Record<string, unknown> },
  });
  const parseArgs = (s: string | undefined): unknown => {
    try {
      return s ? JSON.parse(s) : {};
    } catch {
      return {};
    }
  };

  return {
    label: cfg.label,
    model: cfg.model,
    async forceTool({ system, user, tool, maxTokens }) {
      const res = await withRateLimitRetry(() =>
        client.chat.completions.create({
          model: cfg.model,
          max_tokens: budget(maxTokens),
          ...extraParams,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          tools: [toTool(tool)],
          tool_choice: { type: 'function', function: { name: tool.name } },
        }),
      );
      const call = res.choices[0]?.message.tool_calls?.find((c) => c.type === 'function');
      return call && call.type === 'function' ? parseArgs(call.function.arguments) : undefined;
    },
    async chat({ system, tools, messages, maxTokens, onText }) {
      const params: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: 'system', content: system }];
      for (const m of messages) {
        if (m.role === 'user') params.push({ role: 'user', content: m.content });
        else if (m.role === 'assistant') {
          params.push({
            role: 'assistant',
            content: m.content || null,
            ...(m.toolCalls?.length
              ? {
                  tool_calls: m.toolCalls.map((c) => ({
                    id: c.id,
                    type: 'function' as const,
                    function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
                    ...(c.extra ? { extra_content: c.extra } : {}),
                  })),
                }
              : {}),
          });
        } else {
          for (const r of m.results) params.push({ role: 'tool', tool_call_id: r.id, content: r.isError ? `Error: ${r.content}` : r.content });
        }
      }
      // Non-streaming: Gemini's compat layer is unreliable at streaming parallel tool calls.
      const res = await withRateLimitRetry(() =>
        client.chat.completions.create({
          model: cfg.model,
          max_tokens: budget(maxTokens),
          ...extraParams,
          messages: params,
          tools: tools.map(toTool),
        }),
      );
      const msg = res.choices[0]?.message;
      const text = msg?.content ?? '';
      if (text) onText(text);
      const toolCalls: ToolCall[] = [];
      (msg?.tool_calls ?? []).forEach((c, i) => {
        if (c.type !== 'function') return;
        toolCalls.push({
          id: c.id || `call_${Date.now()}_${i}`,
          name: c.function.name,
          input: parseArgs(c.function.arguments),
          extra: (c as { extra_content?: unknown }).extra_content,
        });
      });
      return { text, toolCalls };
    },
  };
}

// ---------------------------------------------------------------- selection

const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

function selectedProvider(): string {
  const explicit = process.env.LLM_PROVIDER?.toLowerCase();
  if (explicit) return explicit;
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.NANOGPT_API_KEY) return 'nanogpt';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.LLM_API_KEY) return 'openai-compatible';
  return 'gemini';
}

function keyVarFor(provider: string): string {
  if (provider === 'anthropic') return 'ANTHROPIC_API_KEY';
  if (provider === 'gemini') return 'GEMINI_API_KEY';
  if (provider === 'nanogpt') return 'NANOGPT_API_KEY';
  return 'LLM_API_KEY';
}

export function hasApiKey(): boolean {
  return Boolean(process.env[keyVarFor(selectedProvider())]);
}

let cached: Provider | undefined;

export function getProvider(): Provider {
  if (cached) return cached;
  const name = selectedProvider();
  const keyVar = keyVarFor(name);
  const apiKey = process.env[keyVar];
  if (!apiKey) {
    throw new Error(`${keyVar} is not set. Copy .env.example to .env, add your key, and restart the server.`);
  }
  switch (name) {
    case 'anthropic':
      cached = anthropicProvider();
      break;
    case 'gemini':
      cached = openAiCompatibleProvider({
        label: 'Gemini',
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        apiKey,
        model: process.env.GEMINI_MODEL || process.env.LLM_MODEL || DEFAULT_GEMINI_MODEL,
        thinking: true,
      });
      break;
    case 'nanogpt': {
      const model = process.env.NANOGPT_MODEL || process.env.LLM_MODEL;
      if (!model) {
        throw new Error('NANOGPT_MODEL is not set. Run `npm run models` to list valid model ids, then set it in .env.');
      }
      cached = openAiCompatibleProvider({
        label: 'NanoGPT',
        // The subscription endpoint only serves subscription-included models, so it never bills pay-as-you-go.
        baseURL: process.env.NANOGPT_BASE_URL || 'https://nano-gpt.com/api/subscription/v1',
        apiKey,
        model,
      });
      break;
    }
    case 'openai-compatible': {
      const baseURL = process.env.LLM_BASE_URL;
      const model = process.env.LLM_MODEL;
      if (!baseURL || !model) throw new Error('LLM_BASE_URL and LLM_MODEL are required when LLM_PROVIDER=openai-compatible.');
      cached = openAiCompatibleProvider({ label: 'OpenAI-compatible', baseURL, apiKey, model });
      break;
    }
    default:
      throw new Error(`Unknown LLM_PROVIDER "${name}". Use gemini, nanogpt, anthropic, or openai-compatible.`);
  }
  return cached;
}

export function describeProvider(): { provider: string; model: string } {
  const name = selectedProvider();
  const model =
    name === 'anthropic'
      ? process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5'
      : name === 'gemini'
        ? process.env.GEMINI_MODEL || process.env.LLM_MODEL || DEFAULT_GEMINI_MODEL
        : name === 'nanogpt'
          ? process.env.NANOGPT_MODEL || process.env.LLM_MODEL || '(unset)'
          : process.env.LLM_MODEL || '(unset)';
  return { provider: name, model };
}

/** One-shot call that forces a single schema-validated tool answer, with one validation retry. */
export async function callTool<T>(opts: { system: string; user: string; tool: ToolDef; maxTokens?: number }): Promise<T> {
  const provider = getProvider();
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const input = await provider.forceTool({
      system: opts.system,
      user: lastError ? `${opts.user}\n\nYour previous answer failed validation: ${lastError}\nPlease fix it.` : opts.user,
      tool: opts.tool,
      maxTokens: opts.maxTokens ?? 4096,
    });
    if (input === undefined) {
      lastError = 'No tool call was returned.';
      continue;
    }
    const parsed = opts.tool.schema.safeParse(input);
    if (parsed.success) return parsed.data as T;
    lastError = z.prettifyError(parsed.error);
  }
  throw new Error(`The model returned an invalid response: ${lastError}`);
}
