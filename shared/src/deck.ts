import type { Deck, Slide } from './types';

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Compact description of a deck for LLM prompts (omits bulky chart rows). */
export function summarizeDeck(deck: Deck): string {
  const lines = [`Deck "${deck.title}" — theme: ${deck.themeId}`];
  deck.slides.forEach((s: Slide, i: number) => {
    lines.push(`Slide ${i + 1} [id=${s.id}] layout=${s.layout}`);
    for (const el of s.elements) {
      const head = `  - [id=${el.id}] ${el.type} @${el.region}`;
      switch (el.type) {
        case 'title':
        case 'subtitle':
        case 'text':
          lines.push(`${head}: ${JSON.stringify(el.text)}`);
          break;
        case 'bullets':
          lines.push(`${head}: ${JSON.stringify(el.items)}`);
          break;
        case 'stat':
          lines.push(`${head}: ${JSON.stringify(el.value)} / ${JSON.stringify(el.label)}`);
          break;
        case 'chart':
          lines.push(
            `${head}: ${el.chartType} x=${el.xKey} y=${el.yKeys.join(',')} (${el.data.length} rows)` +
              (el.title ? ` title=${JSON.stringify(el.title)}` : ''),
          );
          break;
      }
    }
  });
  return lines.join('\n');
}
