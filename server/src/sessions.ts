import { randomUUID } from 'node:crypto';
import type { Insight } from '@smart-slides/shared';
import type { Dataset } from './data';

export interface Session {
  id: string;
  dataset: Dataset;
  insights: Insight[];
}

const MAX_SESSIONS = 20;
const sessions = new Map<string, Session>();

export function createSession(dataset: Dataset): Session {
  const session: Session = { id: randomUUID(), dataset, insights: [] };
  sessions.set(session.id, session);
  // Keep memory bounded: drop the oldest sessions (Map preserves insertion order).
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value as string;
    sessions.get(oldest)?.dataset.db.close();
    sessions.delete(oldest);
  }
  return session;
}

export function getSession(id: unknown): Session | undefined {
  return typeof id === 'string' ? sessions.get(id) : undefined;
}
