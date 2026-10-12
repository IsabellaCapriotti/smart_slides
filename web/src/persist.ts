import { get, set } from 'idb-keyval';
import type { Deck, UploadedFile } from '@smart-slides/shared';

export interface SavedDeck {
  id: string;
  name: string;
  savedAt: number;
  deck: Deck;
  /** Original CSVs so the agent can keep querying after a reload. */
  files?: UploadedFile[];
  /** Legacy single-file shape. */
  csv?: string;
  fileName?: string;
}

const KEY = 'smart-slides:decks';

export async function listSaved(): Promise<SavedDeck[]> {
  try {
    return ((await get<SavedDeck[]>(KEY)) ?? []).sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export async function saveDeck(entry: SavedDeck): Promise<void> {
  const all = (await listSaved()).filter((d) => d.id !== entry.id);
  await set(KEY, [entry, ...all]);
}

export async function removeSaved(id: string): Promise<void> {
  const all = (await listSaved()).filter((d) => d.id !== id);
  await set(KEY, all);
}
