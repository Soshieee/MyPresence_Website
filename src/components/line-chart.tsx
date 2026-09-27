type LineItem = {
  label: string;
  value: number;
  color?: string;
};

type Props = {
  title: string;
  items: LineItem[];
  emptyText?: string;
};

const WIDTH = 640;
const HEIGHT = 260;
const LEFT = 42;
const RIGHT = 16;
const TOP = 18;
const BOTTOM = 62;

export default function LineChart({ title, items, emptyText = "No data yet." }: Props) {
  const maxValue = Math.max(...items.map((item) => item.value), 1);
  const plotWidth = WIDTH - LEFT - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const points = items.map((item, index) => ({
    ...item,
    x: LEFT + (items.length < 2 ? plotWidth / 2 : (index / (items.length - 1)) * plotWidth),
    y: TOP + plotHeight - (item.value / maxValue) * plotHeight
  }));
  const linePoints = points.map((point) => `${point.x},${point.y}`).join(" ");
  const hasData = items.some((item) => item.value > 0);

  return (
    <section className="analytics-panel min-w-0">
      <h3 className="font-[var(--font-heading)] text-lg text-[#24362f]">{title}</h3>
      {!hasData ? (
        <p className="mt-3 text-sm text-[#5d736a]">{emptyText}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="h-auto min-w-[520px] w-full"
            role="img"
            aria-label={`${title} line chart`}
          >
            {[0, 0.5, 1].map((fraction) => {
              const y = TOP + plotHeight * fraction;
              const value = Math.round(maxValue * (1 - fraction));
              return (
                <g key={fraction}>
                  <line x1={LEFT} x2={WIDTH - RIGHT} y1={y} y2={y} stroke="#d9e3df" strokeDasharray="3 5" />
                  <text x={LEFT - 8} y={y + 4} textAnchor="end" fill="#71827b" fontSize="10">{value}</text>
                </g>
              );
            })}
            <line x1={LEFT} x2={WIDTH - RIGHT} y1={TOP + plotHeight} y2={TOP + plotHeight} stroke="#aebfb8" />
            <polyline
              points={linePoints}
              fill="none"
              stroke="#0f766e"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {points.map((point) => {
              const words = point.label.split(/\s+/);
              const firstLine = words.length > 2 ? words.slice(0, 2).join(" ") : point.label;
              const secondLine = words.length > 2 ? words.slice(2).join(" ") : "";
              return (
                <g key={point.label}>
                  <title>{`${point.label}: ${point.value}`}</title>
                  <circle cx={point.x} cy={point.y} r="5" fill={point.color ?? "#0f766e"} stroke="white" strokeWidth="2" />
                  <text x={point.x} y={TOP + plotHeight + 19} textAnchor="middle" fill="#496359" fontSize="10" fontWeight="600">
                    <tspan x={point.x}>{firstLine}</tspan>
                    {secondLine ? <tspan x={point.x} dy="12">{secondLine}</tspan> : null}
                  </text>
                  <text x={point.x} y={point.y - 10} textAnchor="middle" fill="#315349" fontSize="10" fontWeight="700">{point.value}</text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </section>
  );
}