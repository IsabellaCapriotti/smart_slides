import type { LayoutId, Region, Slide, SlideElement } from './types';

/** Slide canvas in inches (16:9). The web renderer uses 72 px per inch. */
export const SLIDE_W = 13.333;
export const SLIDE_H = 7.5;
export const PX_PER_IN = 72;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const REGION_RECTS: Record<LayoutId, Partial<Record<Region, Rect>>> = {
  title: {
    main: { x: 1.1, y: 1.9, w: 10.8, h: 3.7 },
    footer: { x: 1.1, y: 6.6, w: 10.8, h: 0.4 },
  },
  split: {
    header: { x: 0.6, y: 0.55, w: 12.1, h: 1.1 },
    left: { x: 0.6, y: 1.85, w: 7.5, h: 4.8 },
    right: { x: 8.4, y: 1.85, w: 4.3, h: 4.8 },
    footer: { x: 0.6, y: 6.85, w: 12.1, h: 0.4 },
  },
  full: {
    header: { x: 0.6, y: 0.55, w: 12.1, h: 1.1 },
    main: { x: 0.6, y: 1.85, w: 12.1, h: 4.8 },
    footer: { x: 0.6, y: 6.85, w: 12.1, h: 0.4 },
  },
};

export function regionsFor(layout: LayoutId): Region[] {
  return Object.keys(REGION_RECTS[layout]) as Region[];
}

export const LAYOUT_DESCRIPTIONS: Record<LayoutId, string> = {
  title: 'regions: main (title + subtitle, vertically centred), footer',
  split: 'regions: header, left (wide), right (narrow), footer',
  full: 'regions: header, main (full width), footer',
};

/** Move any element whose region is not valid for the layout to the closest valid one. */
export function normalizeSlide(slide: Slide): Slide {
  const valid = regionsFor(slide.layout);
  const fallback: Record<LayoutId, Region> = { title: 'main', split: 'left', full: 'main' };
  return {
    ...slide,
    elements: slide.elements.map((el) => {
      if (valid.includes(el.region)) return el;
      let region = fallback[slide.layout];
      if (el.type === 'title' || el.type === 'subtitle') {
        region = slide.layout === 'title' ? 'main' : 'header';
      } else if (el.region === 'right' && slide.layout === 'full') {
        region = 'main';
      }
      return { ...el, region };
    }),
  };
}

const WEIGHTS: Record<SlideElement['type'], number> = {
  title: 1,
  subtitle: 0.7,
  chart: 4,
  bullets: 2.5,
  text: 1.5,
  stat: 1.3,
};
const GAP = 0.15;

export interface Placed {
  element: SlideElement;
  rect: Rect;
}

/** Stacks the elements of each region top-to-bottom, sharing height by weight. */
export function placeElements(slide: Slide): Placed[] {
  const rects = REGION_RECTS[slide.layout];
  const placed: Placed[] = [];
  for (const region of Object.keys(rects) as Region[]) {
    const rect = rects[region]!;
    const els = slide.elements.filter((e) => e.region === region);
    if (!els.length) continue;
    const totalGap = GAP * (els.length - 1);
    const totalWeight = els.reduce((s, e) => s + WEIGHTS[e.type], 0);
    const avail = rect.h - totalGap;
    const heights = els.map((e) => {
      if (region === 'footer') return rect.h;
      let h = (WEIGHTS[e.type] / totalWeight) * avail;
      if (e.type === 'title' && slide.layout !== 'title') h = Math.min(h, 0.9);
      return h;
    });
    const used = heights.reduce((s, h) => s + h, 0) + totalGap;
    let y = rect.y;
    // Vertically centre the block in the title layout.
    if (slide.layout === 'title' && region === 'main') y += Math.max(0, (rect.h - used) / 2);
    els.forEach((el, i) => {
      placed.push({ element: el, rect: { x: rect.x, y, w: rect.w, h: heights[i] } });
      y += heights[i] + GAP;
    });
  }
  return placed;
}

/** Decorative accent shapes (inches), shared by the web renderer and PPTX export. */
export function decorations(layout: LayoutId): Rect[] {
  if (layout === 'title') return [{ x: 0, y: 0, w: 0.32, h: SLIDE_H }];
  return [{ x: 0.6, y: 0.32, w: 0.7, h: 0.07 }];
}

export interface TextStyle {
  fontSize: number; // pt (== px in the 960px-wide web canvas)
  bold: boolean;
  color: 'text' | 'muted' | 'accent';
  font: 'heading' | 'body';
}

export function textStyle(slide: Slide, el: SlideElement, rect: Rect): TextStyle {
  switch (el.type) {
    case 'title':
      return { fontSize: slide.layout === 'title' ? 44 : 30, bold: true, color: 'text', font: 'heading' };
    case 'subtitle':
      return { fontSize: slide.layout === 'title' ? 22 : 17, bold: false, color: 'muted', font: 'body' };
    case 'stat':
      return { fontSize: 38, bold: true, color: 'accent', font: 'heading' };
    case 'bullets': {
      const chars = el.items.reduce((s, i) => s + i.length, 0);
      const density = chars / (rect.w * rect.h);
      const fontSize = density > 28 ? 12 : density > 20 ? 14 : density > 12 ? 16 : 18;
      return { fontSize, bold: false, color: 'text', font: 'body' };
    }
    case 'text': {
      if (el.region === 'footer') return { fontSize: 11, bold: false, color: 'muted', font: 'body' };
      const density = el.text.length / (rect.w * rect.h);
      return { fontSize: density > 24 ? 12 : density > 14 ? 14 : 16, bold: false, color: 'text', font: 'body' };
    }
    default:
      return { fontSize: 14, bold: false, color: 'text', font: 'body' };
  }
}
