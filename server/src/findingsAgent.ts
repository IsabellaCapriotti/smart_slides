import { z } from 'zod';
import type { ChatMessage, StreamEvent } from '@smart-slides/shared';
import { getProvider, type ToolDef } from './llm';
import { generateFindings } from './findings';
import { toProviderMessages } from './agent';
import { profileForPrompt } from './data';
import type { Session } from './sessions';

export const MAX_FINDINGS = 30;
export const MORE_BATCH = 6;

const focusField = z
  .string()
  .optional()
  .describe('What the user wants findings about, in their words (e.g. "regional differences in churn"). Omit for a general search.');

const tools = {
  find_more_findings: {
    name: 'find_more_findings',
    description:
      'Look for additional findings and ADD them to the existing list (existing findings and the user\'s selection are kept). ' +
      'Pass `focus` when the user asks for a specific kind of finding or topic.',
    schema: z.object({
      focus: focusField,
      count: z.number().int().min(1).max(MORE_BATCH).optional().describe(`How many to look for (default ${MORE_BATCH}).`),
    }),
  },
  regenerate_findings: {
    name: 'regenerate_findings',
    description:
      'Throw away ALL current findings and the user\'s selection, then generate a fresh list. ' +
      'Only for an explicit request to start over / regenerate / replace. Pass `focus` if the new list should be about something specific.',
    schema: z.object({
      focus: focusField,
      confirmed: z
        .boolean()
        .optional()
        .describe('Set true ONLY after the user has explicitly agreed in this conversation to discard their current selection.'),
    }),
  },
} satisfies Record<string, ToolDef>;

interface Ctx {
  session: Session;
  selectedCount: number;
  emit: (e: StreamEvent) => void;
}

async function execute(ctx: Ctx, name: string, input: unknown): Promise<{ result: string; summary: string }> {
  const { session } = ctx;
  const progress = (message: string) => ctx.emit({ type: 'progress', message });

  if (name === 'find_more_findings') {
    const { focus, count } = tools.find_more_findings.schema.parse(input);
    const room = MAX_FINDINGS - session.findings.length;
    if (room <= 0) {
      throw new Error(`There are already ${MAX_FINDINGS} findings, the maximum. The user must regenerate to replace them.`);
    }
    const fresh = await generateFindings(session, {
      focus,
      existing: session.findings,
      count: Math.min(count ?? MORE_BATCH, room),
      onProgress: progress,
    });
    if (!fresh.length) {
      return { result: 'No new distinct findings turned up. Suggest a different angle.', summary: 'No new findings found' };
    }
    const added = fresh.slice(0, room);
    session.findings = [...session.findings, ...added];
    ctx.emit({ type: 'findings', findings: session.findings });
    return {
      result: `Added ${added.length} finding(s), ${session.findings.length} total. New: ${added.map((f) => f.headline).join(' | ')}`,
      summary: focus ? `Added ${added.length} on “${focus}”` : `Added ${added.length} findings`,
    };
  }

  if (name === 'regenerate_findings') {
    const { focus, confirmed } = tools.regenerate_findings.schema.parse(input);
    if (ctx.selectedCount > 0 && !confirmed) {
      return {
        result:
          `Not done: the user has ${ctx.selectedCount} finding(s) selected and regenerating will clear that selection. ` +
          'Ask them to confirm, and call this tool again with confirmed=true only after they say yes.',
        summary: 'Needs confirmation',
      };
    }
    const fresh = await generateFindings(session, { focus, onProgress: progress });
    session.findings = fresh;
    ctx.emit({ type: 'findings', findings: fresh, replaced: true });
    return {
      result: `Replaced the list with ${fresh.length} new finding(s): ${fresh.map((f) => f.headline).join(' | ')}`,
      summary: focus ? `Regenerated on “${focus}”` : 'Regenerated findings',
    };
  }

  throw new Error(`Unknown tool ${name}`);
}

function buildSystem(ctx: Ctx): string {
  const { session } = ctx;
  return `You are the assistant on the "Findings" step of "Smart Slides". The user is looking at a list of data findings (each a chart plus a claim) and will pick some to build a presentation from.

What you can do, via tools:
- find_more_findings: add findings, optionally focused on a topic the user names ("something about churn by region", "compare plans").
- regenerate_findings: replace the whole list. Only when they clearly want to start over. If they have findings selected (see below), ask for confirmation first and only pass confirmed=true after they agree.

How to work:
- A request like "generate more", "find more", "any other trends?" -> find_more_findings. A request describing a kind of finding ("look at seasonality", "what drives refunds?") -> find_more_findings with that as the focus. Reword the focus into a short noun phrase.
- Never guess at findings yourself or quote numbers you did not get from a tool result.
- After a tool call, reply in ONE or TWO short sentences saying what was added and what stands out. The user sees the new findings in the list, so do not re-list them in full.
- You cannot build slides or change styles here; if asked, tell them to select findings and press "Continue to style".
- If a request is unclear, ask one brief question.

STATE: ${session.findings.length}/${MAX_FINDINGS} findings in the list; the user has ${ctx.selectedCount} selected.
Existing findings:
${session.findings.map((f, i) => `${i + 1}. ${f.headline}`).join('\n') || '(none yet)'}

DATASET:
${profileForPrompt(session.dataset.profile)}`;
}

export async function runFindingsAgent(opts: {
  session: Session;
  selectedCount: number;
  message: string;
  history: ChatMessage[];
  emit: (e: StreamEvent) => void;
}): Promise<void> {
  const provider = getProvider();
  const ctx: Ctx = { session: opts.session, selectedCount: opts.selectedCount, emit: opts.emit };
  const msgs = toProviderMessages(opts.history, opts.message);
  const toolList = Object.values(tools) as ToolDef[];

  for (let turn = 0; turn < 5; turn++) {
    const { text, toolCalls } = await provider.chat({
      system: buildSystem(ctx),
      tools: toolList,
      messages: msgs,
      maxTokens: 1024,
      onText: (delta) => ctx.emit({ type: 'text', delta }),
    });
    msgs.push({ role: 'assistant', content: text, toolCalls });
    if (!toolCalls.length) break;

    const results: { id: string; content: string; isError?: boolean }[] = [];
    for (const call of toolCalls) {
      try {
        const out = await execute(ctx, call.name, call.input);
        ctx.emit({ type: 'tool', name: call.name, summary: out.summary });
        results.push({ id: call.id, content: out.result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.emit({ type: 'tool', name: call.name, summary: `Failed: ${message}` });
        results.push({ id: call.id, content: message, isError: true });
      }
    }
    msgs.push({ role: 'tool', results });
  }
}
