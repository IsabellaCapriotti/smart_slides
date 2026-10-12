export interface Theme {
  id: string;
  name: string;
  description: string;
  mode: 'light' | 'dark';
  colors: {
    background: string;
    surface: string;
    text: string;
    muted: string;
    accent: string;
    grid: string;
  };
  /** Series colours for charts, in order. */
  palette: string[];
  /** Fonts are limited to ones PowerPoint users generally have, so web + PPTX match. */
  fonts: { heading: string; body: string };
}

export const THEMES: Theme[] = [
  {
    id: 'aurora',
    name: 'Aurora',
    description: 'Dark, vivid, and modern. Great for product and tech audiences.',
    mode: 'dark',
    colors: { background: '#0F1020', surface: '#1A1B33', text: '#F4F4FA', muted: '#A3A5C4', accent: '#7C5CFF', grid: '#2D2F52' },
    palette: ['#7C5CFF', '#22D3EE', '#F472B6', '#FBBF24', '#34D399', '#60A5FA'],
    fonts: { heading: 'Trebuchet MS', body: 'Arial' },
  },
  {
    id: 'editorial',
    name: 'Editorial',
    description: 'Warm paper tones with a serif headline. Reads like a magazine feature.',
    mode: 'light',
    colors: { background: '#FAF7F2', surface: '#EFE8DD', text: '#1F1B16', muted: '#6F665B', accent: '#C2410C', grid: '#DDD3C4' },
    palette: ['#C2410C', '#1D4E89', '#2F7F5F', '#B8860B', '#7A3E65', '#4B5563'],
    fonts: { heading: 'Georgia', body: 'Arial' },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    description: 'Clean, bright, and corporate-friendly blues.',
    mode: 'light',
    colors: { background: '#FFFFFF', surface: '#EEF5FB', text: '#0B2A43', muted: '#5B7487', accent: '#0A7BD4', grid: '#D8E4EE' },
    palette: ['#0A7BD4', '#00B4A6', '#F59E0B', '#6366F1', '#EF4444', '#64748B'],
    fonts: { heading: 'Calibri', body: 'Calibri' },
  },
  {
    id: 'graphite',
    name: 'Graphite',
    description: 'Understated charcoal with a gold accent. Serious and executive.',
    mode: 'dark',
    colors: { background: '#16181D', surface: '#23262E', text: '#EDEEF0', muted: '#9AA0AA', accent: '#F5B301', grid: '#343843' },
    palette: ['#F5B301', '#8AB4F8', '#E57373', '#81C784', '#BA68C8', '#B0BEC5'],
    fonts: { heading: 'Arial', body: 'Arial' },
  },
  {
    id: 'meadow',
    name: 'Meadow',
    description: 'Fresh greens on a soft tint. Calm, organic, approachable.',
    mode: 'light',
    colors: { background: '#F4F9F3', surface: '#E3EFE1', text: '#14301F', muted: '#587061', accent: '#1F8A4C', grid: '#CFE0CC' },
    palette: ['#1F8A4C', '#0E7490', '#D97706', '#7C3AED', '#DC2626', '#65A30D'],
    fonts: { heading: 'Trebuchet MS', body: 'Calibri' },
  },
  {
    id: 'coral',
    name: 'Coral Pop',
    description: 'Bold and playful with a punchy coral accent on white.',
    mode: 'light',
    colors: { background: '#FFFFFF', surface: '#FFF0F2', text: '#231F20', muted: '#7A6E70', accent: '#F43F5E', grid: '#F1DADD' },
    palette: ['#F43F5E', '#2563EB', '#F59E0B', '#10B981', '#8B5CF6', '#0EA5E9'],
    fonts: { heading: 'Verdana', body: 'Verdana' },
  },
];

export const DEFAULT_THEME_ID = 'ocean';

export function getTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME_ID)!;
}
