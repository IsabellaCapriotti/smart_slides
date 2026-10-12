import PptxGenJS from 'pptxgenjs';
import { decorations, getTheme, placeElements, textStyle, type ChartElement, type Deck } from '@smart-slides/shared';

const hex = (c: string) => c.replace('#', '').toUpperCase();

function addChart(pptx: PptxGenJS, slide: PptxGenJS.Slide, el: ChartElement, rect: { x: number; y: number; w: number; h: number }, deckTheme: ReturnType<typeof getTheme>) {
  const labels = el.data.map((r) => String(r[el.xKey] ?? ''));
  const series = el.yKeys.map((k) => ({ name: k, labels, values: el.data.map((r) => Number(r[k] ?? 0)) }));
  const common: PptxGenJS.IChartOpts = {
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    chartColors: deckTheme.palette.map(hex),
    catAxisLabelColor: hex(deckTheme.colors.muted),
    valAxisLabelColor: hex(deckTheme.colors.muted),
    catAxisLabelFontFace: deckTheme.fonts.body,
    valAxisLabelFontFace: deckTheme.fonts.body,
    catAxisLabelFontSize: el.data.length > 14 ? 8 : el.data.length > 8 ? 9 : 11,
    catAxisLabelRotate: el.data.length > 8 || Math.max(0, ...labels.map((l) => l.length)) > 12 ? 315 : 0,
    valAxisLabelFontSize: 11,
    valGridLine: { color: hex(deckTheme.colors.grid), size: 0.5 },
    catGridLine: { style: 'none' },
    showLegend: el.yKeys.length > 1 || el.chartType === 'pie',
    legendPos: 'b',
    legendColor: hex(deckTheme.colors.muted),
    legendFontFace: deckTheme.fonts.body,
    legendFontSize: 11,
    showTitle: Boolean(el.title),
    title: el.title,
    titleColor: hex(deckTheme.colors.text),
    titleFontFace: deckTheme.fonts.body,
    titleFontSize: 14,
    showCatAxisTitle: Boolean(el.xLabel),
    catAxisTitle: el.xLabel,
    catAxisTitleColor: hex(deckTheme.colors.muted),
    showValAxisTitle: Boolean(el.yLabel),
    valAxisTitle: el.yLabel,
    valAxisTitleColor: hex(deckTheme.colors.muted),
  };

  switch (el.chartType) {
    case 'bar':
      slide.addChart(pptx.ChartType.bar, series, { ...common, barDir: 'col', barGrouping: 'clustered' });
      break;
    case 'stacked-bar':
      slide.addChart(pptx.ChartType.bar, series, { ...common, barDir: 'col', barGrouping: 'stacked' });
      break;
    case 'line':
      slide.addChart(pptx.ChartType.line, series, { ...common, lineSize: 3, lineDataSymbolSize: 7 });
      break;
    case 'area':
      slide.addChart(pptx.ChartType.area, series, common);
      break;
    case 'pie':
      slide.addChart(pptx.ChartType.pie, [series[0]], { ...common, showPercent: true, dataLabelColor: 'FFFFFF', showLegend: true });
      break;
    case 'scatter': {
      const xs = el.data.map((r) => Number(r[el.xKey] ?? 0));
      const ys = el.data.map((r) => Number(r[el.yKeys[0]] ?? 0));
      slide.addChart(pptx.ChartType.scatter, [{ name: el.xKey, values: xs }, { name: el.yKeys[0], values: ys }], {
        ...common,
        lineSize: 0,
        lineDataSymbolSize: 8,
        showLegend: false,
      });
      break;
    }
  }
}

export async function exportPptx(deck: Deck): Promise<void> {
  const theme = getTheme(deck.themeId);
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 in
  pptx.title = deck.title;

  for (const s of deck.slides) {
    const slide = pptx.addSlide();
    slide.background = { color: hex(theme.colors.background) };

    for (const d of decorations(s.layout)) {
      slide.addShape(pptx.ShapeType.rect, { x: d.x, y: d.y, w: d.w, h: d.h, fill: { color: hex(theme.colors.accent) }, line: { color: hex(theme.colors.accent), width: 0 } });
    }

    for (const { element: el, rect } of placeElements(s)) {
      const ts = textStyle(s, el, rect);
      const color = hex(theme.colors[ts.color]);
      const fontFace = ts.font === 'heading' ? theme.fonts.heading : theme.fonts.body;
      const box = { x: rect.x, y: rect.y, w: rect.w, h: rect.h, fontFace, color, margin: 0 };

      switch (el.type) {
        case 'title':
          slide.addText(el.text, { ...box, fontSize: ts.fontSize, bold: true, valign: s.layout === 'title' ? 'bottom' : 'middle', fit: 'shrink' });
          break;
        case 'subtitle':
          slide.addText(el.text, { ...box, fontSize: ts.fontSize, valign: 'top', fit: 'shrink' });
          break;
        case 'text':
          slide.addText(el.text, { ...box, fontSize: ts.fontSize, valign: el.region === 'footer' ? 'middle' : 'top', fit: 'shrink' });
          break;
        case 'bullets':
          slide.addText(
            el.items.map((t) => ({ text: t, options: { bullet: { code: '2022' }, breakLine: true, paraSpaceAfter: 8 } })),
            { ...box, fontSize: ts.fontSize, valign: 'middle', fit: 'shrink' },
          );
          break;
        case 'stat':
          slide.addShape(pptx.ShapeType.roundRect, { x: rect.x, y: rect.y, w: rect.w, h: rect.h, fill: { color: hex(theme.colors.surface) }, line: { color: hex(theme.colors.surface), width: 0 }, rectRadius: 0.1 });
          slide.addText(
            [
              { text: el.value, options: { fontSize: ts.fontSize, bold: true, color, fontFace, breakLine: true } },
              { text: el.label, options: { fontSize: 14, color: hex(theme.colors.muted), fontFace: theme.fonts.body } },
            ],
            { x: rect.x + 0.2, y: rect.y, w: rect.w - 0.4, h: rect.h, valign: 'middle', margin: 0, fit: 'shrink' },
          );
          break;
        case 'chart':
          if (el.data.length) addChart(pptx, slide, el, rect, theme);
          break;
      }
    }
  }

  const safe = deck.title.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'presentation';
  await pptx.writeFile({ fileName: `${safe}.pptx` });
}
