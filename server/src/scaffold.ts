import { z } from 'zod';
import { uid, type Deck, type Finding, type Slide } from '@smart-slides/shared';
import { THEMES } from '@smart-slides/shared';
import { callTool } from './llm';
import { profileForPrompt } from './data';
import type { Session } from './sessions';

const ScaffoldSchema = z.object({
  deckTitle: z
    .string()
    .describe('Compelling title about the data and its main story, max 8 words. Must NOT mention any visual theme or style name.'),
  deckSubtitle: z
    .string()
    .describe(
      'A one-line summary tagline for ALL of the data being presented: what the data covers and the overall picture it paints. ' +
        'Zoom out. Do not focus on, name, or quantify any single finding. Max ~14 words.',
    ),
  slides: z.array(
    z.object({
      findingId: z.string(),
      title: z.string().describe('Action title stating the takeaway, max ~12 words'),
      keyPoints: z.array(z.string()).min(2).max(4).describe('Short bullets, max ~12 words each'),
      stats: z.array(z.object({ value: z.string(), label: z.string() })).max(2).describe('0-2 big numbers'),
      chartTitle: z.string().describe('Short chart title'),
    }),
  ),
  closingTitle: z.string().describe('Title of the summary slide, e.g. "What this means"'),
  closingPoints: z.array(z.string()).min(2).max(4).describe('Overall takeaways / recommended actions'),
});

export async function scaffoldDeck(session: Session, findings: Finding[], themeId: string): Promise<Deck> {
  const payload = findings.map((i) => ({
    findingId: i.id,
    headline: i.headline,
    narrative: i.narrative,
    keyFigures: i.keyFigures,
    chartType: i.chart.chartType,
    columns: [i.chart.xKey, ...i.chart.yKeys],
  }));

  const out = await callTool<z.infer<typeof ScaffoldSchema>>({
    system:
      'You are a presentation designer writing concise, executive-ready slide copy. ' +
      'Slides contain a chart, a few key points, and big numbers; body text is minimal. ' +
      'Use ONLY numbers from the findings provided. Write one slide per finding, in a logical narrative order. ' +
      'The deck title and subtitle must describe the DATA and the story it tells (its subject, entities, time frame, or main finding). ' +
      'The subtitle is a big-picture tagline covering the whole dataset and ALL the findings together; it must not highlight any one finding or figure. ' +
      'Write the title and subtitle last, after considering every finding as a whole. ' +
      'Never mention visual style, theme names, colours, fonts, or design words (e.g. "Graphite", "Aurora", "dark", "modern") in any title or text.',
    user:
      `Dataset: ${session.dataset.profile.fileName}\n` +
      `Tables and columns: ${session.dataset.profile.tables
        .map((t) => `${t.name} (${t.columns.map((c) => c.name).join(', ')})`)
        .join('; ')}\n` +
      `Findings:\n${JSON.stringify(payload, null, 1)}`,
    tool: { name: 'create_deck_copy', description: 'Submit the slide copy for the deck.', schema: ScaffoldSchema },
    maxTokens: 5000,
  });

  const byId = new Map(findings.map((i) => [i.id, i]));
  const source = `Source: ${session.dataset.profile.fileName}`;
  const slides: Slide[] = [
    {
      id: uid(),
      layout: 'title',
      elements: [
        { id: uid(), type: 'title', region: 'main', text: out.deckTitle },
        { id: uid(), type: 'subtitle', region: 'main', text: out.deckSubtitle },
        { id: uid(), type: 'text', region: 'footer', text: source },
      ],
    },
  ];

  // Honour the model's ordering, then append any finding it skipped so none are lost.
  const seen = new Set<string>();
  const ordered = out.slides.filter((s) => byId.has(s.findingId) && !seen.has(s.findingId) && seen.add(s.findingId));
  for (const i of findings) {
    if (!seen.has(i.id)) {
      ordered.push({ findingId: i.id, title: i.headline, keyPoints: [i.narrative], stats: i.keyFigures.slice(0, 2), chartTitle: '' });
    }
  }

  for (const s of ordered) {
    const finding = byId.get(s.findingId)!;
    slides.push({
      id: uid(),
      layout: 'split',
      elements: [
        { id: uid(), type: 'title', region: 'header', text: s.title },
        {
          id: uid(),
          type: 'chart',
          region: 'left',
          chartType: finding.chart.chartType,
          title: s.chartTitle || undefined,
          xKey: finding.chart.xKey,
          yKeys: finding.chart.yKeys,
          xLabel: finding.chart.xLabel,
          yLabel: finding.chart.yLabel,
          data: finding.chart.data,
          sql: finding.sql,
        },
        ...s.stats.map((st) => ({ id: uid(), type: 'stat' as const, region: 'right' as const, value: st.value, label: st.label })),
        { id: uid(), type: 'bullets', region: 'right', items: s.keyPoints },
        { id: uid(), type: 'text', region: 'footer', text: source },
      ],
    });
  }

  slides.push({
    id: uid(),
    layout: 'full',
    elements: [
      { id: uid(), type: 'title', region: 'header', text: out.closingTitle },
      { id: uid(), type: 'bullets', region: 'main', items: out.closingPoints },
      { id: uid(), type: 'text', region: 'footer', text: source },
    ],
  });

  return { title: out.deckTitle, themeId, slides };
}

const StyleSchema = z.object({
  themeId: z.enum(THEMES.map((t) => t.id) as [string, ...string[]]),
  message: z.string().describe('2-3 friendly sentences: recommend this style and why, then invite them to pick one'),
});

export async function recommendStyle(session: Session, findings: Finding[]): Promise<z.infer<typeof StyleSchema>> {
  return callTool<z.infer<typeof StyleSchema>>({
    system:
      'You are a friendly presentation design assistant guiding a user through a wizard. ' +
      'Recommend exactly one preset from the list, based on the data topic and tone of the chosen findings.',
    user:
      `Dataset: ${session.dataset.profile.fileName}\nChosen findings:\n- ${findings.map((i) => i.headline).join('\n- ')}\n\n` +
      `Presets:\n${THEMES.map((t) => `- ${t.id} (${t.name}): ${t.description}`).join('\n')}`,
    tool: { name: 'recommend_style', description: 'Recommend a style preset.', schema: StyleSchema },
    maxTokens: 500,
  });
}
