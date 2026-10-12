import { useLayoutEffect, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
} from 'recharts';
import {
  PX_PER_IN,
  SLIDE_H,
  SLIDE_W,
  decorations,
  getTheme,
  placeElements,
  textStyle,
  type ChartElement,
  type Slide,
  type Theme,
} from '@smart-slides/shared';

const W = Math.round(SLIDE_W * PX_PER_IN);
const H = Math.round(SLIDE_H * PX_PER_IN);

function Chart({ el, theme, w, h }: { el: ChartElement; theme: Theme; w: number; h: number }) {
  const tick = { fill: theme.colors.muted, fontSize: 12, fontFamily: theme.fonts.body };
  const axis = { stroke: theme.colors.grid };
  const titleH = el.title ? 28 : 0;
  const ch = h - titleH;
  const legend = el.yKeys.length > 1 || el.chartType === 'pie';
  const scatter = el.chartType === 'scatter';

  // Category labels: show every one (never let Recharts silently skip bars' names), shorten long
  // ones, and tilt them only when they would not fit horizontally in their slot.
  const labels = el.data.map((r) => String(r[el.xKey] ?? ''));
  const shown = labels.map((l) => (l.length > 18 ? `${l.slice(0, 17)}…` : l));
  const longest = Math.max(0, ...shown.map((l) => l.length));
  const slot = (w - 46 - 16) / Math.max(1, labels.length);
  const tilt = !scatter && longest * 6.6 > slot - 6;
  const xAxisHeight = tilt ? Math.min(70, 16 + longest * 4.2) : 28;
  const margin = { top: 8, right: 16, bottom: el.xLabel ? 18 : 4, left: el.yLabel ? 8 : 0 };
  const xAxis = (
    <XAxis
      dataKey={el.xKey}
      angle={tilt ? -35 : 0}
      tick={{ ...tick, textAnchor: tilt ? 'end' : 'middle' }}
      {...axis}
      tickLine={false}
      interval={0}
      height={xAxisHeight + (el.xLabel ? 16 : 0)}
      tickFormatter={scatter ? undefined : (v: unknown) => {
        const s = String(v ?? '');
        return s.length > 18 ? `${s.slice(0, 17)}…` : s;
      }}
      label={el.xLabel ? { value: el.xLabel, position: 'insideBottom', offset: 0, fill: theme.colors.muted, fontSize: 12 } : undefined}
      type={scatter ? 'number' : 'category'}
      name={el.xKey}
    />
  );
  const yAxis = (
    <YAxis
      tick={tick}
      {...axis}
      tickLine={false}
      width={46}
      label={el.yLabel ? { value: el.yLabel, angle: -90, position: 'insideLeft', fill: theme.colors.muted, fontSize: 12 } : undefined}
    />
  );
  const grid = <CartesianGrid stroke={theme.colors.grid} vertical={false} />;
  const leg = legend ? <Legend wrapperStyle={{ fontSize: 12, color: theme.colors.muted }} /> : null;
  const c = (i: number) => theme.palette[i % theme.palette.length];
  const common = { width: w, height: ch, data: el.data, margin };

  let chart: React.ReactElement;
  switch (el.chartType) {
    case 'line':
      chart = (
        <LineChart {...common}>
          {grid}
          {xAxis}
          {yAxis}
          {leg}
          {el.yKeys.map((k, i) => (
            <Line key={k} dataKey={k} stroke={c(i)} strokeWidth={3} dot={{ r: 3, fill: c(i) }} isAnimationActive={false} />
          ))}
        </LineChart>
      );
      break;
    case 'area':
      chart = (
        <AreaChart {...common}>
          {grid}
          {xAxis}
          {yAxis}
          {leg}
          {el.yKeys.map((k, i) => (
            <Area key={k} dataKey={k} stroke={c(i)} fill={c(i)} fillOpacity={0.25} strokeWidth={2.5} isAnimationActive={false} />
          ))}
        </AreaChart>
      );
      break;
    case 'pie':
      chart = (
        <PieChart width={w} height={ch}>
          <Pie
            data={el.data}
            dataKey={el.yKeys[0]}
            nameKey={el.xKey}
            outerRadius={Math.min(w, ch) / 2 - 24}
            innerRadius={Math.min(w, ch) / 5}
            stroke={theme.colors.background}
            isAnimationActive={false}
            label={{ fill: theme.colors.text, fontSize: 12 }}
          >
            {el.data.map((_, i) => (
              <Cell key={i} fill={c(i)} />
            ))}
          </Pie>
          {leg}
        </PieChart>
      );
      break;
    case 'scatter':
      chart = (
        <ScatterChart width={w} height={ch} margin={margin}>
          {grid}
          {xAxis}
          <YAxis dataKey={el.yKeys[0]} type="number" tick={tick} {...axis} tickLine={false} width={46} name={el.yKeys[0]} />
          <Scatter data={el.data} fill={c(0)} isAnimationActive={false} />
        </ScatterChart>
      );
      break;
    case 'stacked-bar':
    case 'bar':
    default:
      chart = (
        <BarChart {...common}>
          {grid}
          {xAxis}
          {yAxis}
          {leg}
          {el.yKeys.map((k, i) => (
            <Bar
              key={k}
              dataKey={k}
              fill={c(i)}
              stackId={el.chartType === 'stacked-bar' ? 'a' : undefined}
              radius={el.chartType === 'stacked-bar' ? 0 : [4, 4, 0, 0]}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      );
  }

  return (
    <div style={{ width: w, height: h }}>
      {el.title && (
        <div style={{ height: titleH, color: theme.colors.text, fontFamily: theme.fonts.body, fontSize: 14, fontWeight: 600 }}>
          {el.title}
        </div>
      )}
      {chart}
    </div>
  );
}

/** Renders one slide at its native 960x540 size and scales it to fit its container width. */
export function SlideView({ slide, themeId, className }: { slide: Slide; themeId: string; className?: string }) {
  const theme = getTheme(themeId);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  useLayoutEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const update = () => setScale(node.clientWidth / W);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const placed = placeElements(slide);
  const px = (n: number) => n * PX_PER_IN;

  return (
    <div ref={wrapRef} className={className} style={{ width: '100%', aspectRatio: '16 / 9', position: 'relative', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: W,
          height: H,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          background: theme.colors.background,
          color: theme.colors.text,
          fontFamily: theme.fonts.body,
        }}
      >
        {decorations(slide.layout).map((d, i) => (
          <div
            key={i}
            style={{ position: 'absolute', left: px(d.x), top: px(d.y), width: px(d.w), height: px(d.h), background: theme.colors.accent, borderRadius: slide.layout === 'title' ? 0 : 4 }}
          />
        ))}
        {placed.map(({ element: el, rect }) => {
          const box: React.CSSProperties = { position: 'absolute', left: px(rect.x), top: px(rect.y), width: px(rect.w), height: px(rect.h), overflow: 'hidden' };
          const ts = textStyle(slide, el, rect);
          const color = theme.colors[ts.color === 'text' ? 'text' : ts.color === 'muted' ? 'muted' : 'accent'];
          const font = ts.font === 'heading' ? theme.fonts.heading : theme.fonts.body;
          const base: React.CSSProperties = { fontSize: ts.fontSize, fontWeight: ts.bold ? 700 : 400, color, fontFamily: font, lineHeight: 1.2 };
          switch (el.type) {
            case 'title':
              return (
                <div key={el.id} style={{ ...box, ...base, display: 'flex', alignItems: slide.layout === 'title' ? 'flex-end' : 'center' }}>
                  {el.text}
                </div>
              );
            case 'subtitle':
              return (
                <div key={el.id} style={{ ...box, ...base, display: 'flex', alignItems: 'flex-start' }}>
                  {el.text}
                </div>
              );
            case 'text':
              return (
                <div key={el.id} style={{ ...box, ...base, display: 'flex', alignItems: el.region === 'footer' ? 'center' : 'flex-start', lineHeight: 1.35 }}>
                  {el.text}
                </div>
              );
            case 'bullets':
              return (
                <ul key={el.id} style={{ ...box, ...base, margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: ts.fontSize * 0.55 }}>
                  {el.items.map((item, i) => (
                    <li key={i} style={{ display: 'flex', gap: 10, lineHeight: 1.3 }}>
                      <span style={{ color: theme.colors.accent, fontWeight: 700 }}>•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              );
            case 'stat':
              return (
                <div key={el.id} style={{ ...box, display: 'flex', flexDirection: 'column', justifyContent: 'center', background: theme.colors.surface, borderRadius: 10, padding: '0 16px' }}>
                  <div style={{ ...base, lineHeight: 1.05 }}>{el.value}</div>
                  <div style={{ fontSize: 14, color: theme.colors.muted, fontFamily: theme.fonts.body, marginTop: 2 }}>{el.label}</div>
                </div>
              );
            case 'chart':
              return (
                <div key={el.id} style={box}>
                  <Chart el={el} theme={theme} w={px(rect.w)} h={px(rect.h)} />
                </div>
              );
          }
        })}
      </div>
    </div>
  );
}
