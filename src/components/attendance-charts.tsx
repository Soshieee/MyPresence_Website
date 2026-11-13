"use client";

// Themed Recharts panels for the Records attendance analytics tab.
// Recharts is only mounted when the Analytics tab is active (client-side
// interaction), so SSR/hydration is never involved.

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

export type ChartDatum = {
  label: string;
  value: number;
  color?: string;
};

export type TimelineEventMarker = {
  id: string;
  title: string;
  eventType: string | null;
};

export type TimelinePoint = {
  label: string;
  date?: string;
  value: number;
  prevYearValue: number | null;
  prevMonthValue: number | null;
  events: TimelineEventMarker[];
};

export type GroupedSeries = {
  key: string;
  name: string;
  color: string;
};

const AXIS_TICK = { fill: "#5d736a", fontSize: 11 };
const GRID_STROKE = "#d5dfdb";
const PREV_YEAR_COLOR = "#94a3b8";
const PREV_MONTH_COLOR = "#f59e0b";
const EVENT_DOT_COLOR = "#f59e0b";
const EVENT_DOT_STROKE = "#b45309";

type TooltipPayloadItem = {
  value?: number | string;
  name?: string | number;
  dataKey?: string | number;
  payload?: { label?: string | number; value?: number | string; color?: string };
};

function TooltipCard({
  active,
  payload,
  label,
  unit = "check-ins",
  showShare = false
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
  unit?: string;
  showShare?: boolean;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const first = payload[0];
  const value = typeof first.value === "number" ? first.value : Number(first.value ?? 0);
  const name = first.payload?.label ?? label ?? "";
  const total = payload.reduce((sum, item) => sum + (Number(item.value) || 0), 0);

  return (
    <div className="rounded-xl border border-[#c3d0cb] bg-white/95 px-3 py-2 text-xs shadow-[0_10px_24px_rgba(56,91,79,0.18)]">
      <p className="font-semibold text-[#315349]">{name}</p>
      <p className="mt-0.5 text-[#4f675e]">
        {value} {value === 1 ? unit.replace(/s$/, "") : unit}
        {showShare && total > 0 ? ` • ${Math.round((value / total) * 1000) / 10}% of total` : ""}
      </p>
    </div>
  );
}

function PanelShell({
  title,
  hasData,
  emptyText,
  children
}: {
  title: string;
  hasData: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <section className="analytics-panel">
      <h3 className="font-[var(--font-heading)] text-lg text-[#24362f]">{title}</h3>
      {hasData ? children : <p className="mt-3 text-sm text-[#5d736a]">{emptyText}</p>}
    </section>
  );
}

/** Categorical distribution — themed bar chart, per-bucket colors preserved. */
export function CategoryBarsPanel({
  title,
  items,
  emptyText
}: {
  title: string;
  items: ChartDatum[];
  emptyText: string;
}) {
  const hasData = items.some((item) => item.value > 0);
  const data = items.map((item) => ({
    label: item.label,
    value: item.value,
    fill: item.color ?? "#385b4f"
  }));

  return (
    <PanelShell title={title} hasData={hasData} emptyText={emptyText}>
      <div className="mt-4 h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 18, right: 16, bottom: 4, left: -18 }}>
            <CartesianGrid stroke={GRID_STROKE} strokeDasharray="4 4" vertical={false} />
            <XAxis
              dataKey="label"
              tick={AXIS_TICK}
              tickMargin={8}
              interval={0}
              angle={data.length > 4 ? -18 : 0}
              textAnchor={data.length > 4 ? "end" : "middle"}
              height={data.length > 4 ? 46 : 30}
            />
            <YAxis allowDecimals={false} tick={AXIS_TICK} />
            <Tooltip content={<TooltipCard />} cursor={{ fill: "rgba(56,91,79,0.06)" }} />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={56}>
              {data.map((entry) => (
                <Cell key={entry.label} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </PanelShell>
  );
}

/** Distribution donut with legend and center total — used for the demographics row. */
export function DonutStatPanel({
  title,
  items,
  emptyText,
  centerLabel = "people"
}: {
  title: string;
  items: ChartDatum[];
  emptyText: string;
  centerLabel?: string;
}) {
  const hasData = items.some((item) => item.value > 0);
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const data = items
    .filter((item) => item.value > 0)
    .map((item) => ({
      label: item.label,
      value: item.value,
      fill: item.color ?? "#385b4f"
    }));

  return (
    <PanelShell title={title} hasData={hasData} emptyText={emptyText}>
      <div className="mt-1">
        {/* Fixed-size chart box + HTML legend below it: the donut's size and
            center no longer depend on how many legend entries recharts renders,
            so all four stat panels align on every page. */}
        <div className="relative h-[180px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Tooltip content={<TooltipCard showShare />} />
              <Pie
                data={data}
                dataKey="value"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius={54}
                outerRadius={82}
                paddingAngle={3}
                strokeWidth={0}
              >
                {data.map((entry) => (
                  <Cell key={entry.label} fill={entry.fill} />
                ))}
              </Pie>
              <text
                x="50%"
                y="46%"
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-[#22322d] font-semibold"
                style={{ fontSize: 24 }}
              >
                {total}
              </text>
              <text
                x="50%"
                y="59%"
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-[#5d736a]"
                style={{ fontSize: 10 }}
              >
                {centerLabel}
              </text>
            </PieChart>
          </ResponsiveContainer>
        </div>
        {data.length > 0 ? (
          <ul className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
            {data.map((item) => (
              <li key={item.label} className="flex items-center gap-1.5 text-[11px] font-semibold text-[#496359]">
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: item.fill }}
                />
                {item.label}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </PanelShell>
  );
}

type TimelineProps = {
  title: string;
  granularity: "month" | "year";
  points: TimelinePoint[];
  showPrevYear: boolean;
  showPrevMonth: boolean;
  hasPrevYearData: boolean;
  hasPrevMonthData: boolean;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
};

function TimelineTooltip({
  active,
  payload,
  label,
  pointByLabel
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
  pointByLabel?: Map<string, TimelinePoint>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = pointByLabel?.get(String(label));
  if (!point) return null;

  const dateLabel = point.date
    ? new Date(`${point.date}T00:00:00`).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric"
      })
    : String(label);

  return (
    <div className="max-w-[260px] rounded-xl border border-[#c3d0cb] bg-white/95 px-3 py-2 text-xs shadow-[0_10px_24px_rgba(56,91,79,0.18)]">
      <p className="font-semibold text-[#315349]">{dateLabel}</p>
      <p className="mt-0.5 text-[#4f675e]">
        Selected period: <span className="font-semibold text-[#315349]">{point.value}</span> attendees
      </p>
      {point.prevYearValue !== null ? (
        <p className="text-[#64748b]">
          Previous year: <span className="font-semibold">{point.prevYearValue}</span>
        </p>
      ) : null}
      {point.prevMonthValue !== null ? (
        <p className="text-[#b45309]">
          Previous month: <span className="font-semibold">{point.prevMonthValue}</span>
        </p>
      ) : null}
      {point.events.length > 0 ? (
        <div className="mt-1 border-t border-[#e2e8e5] pt-1">
          {point.events.map((event) => (
            <p key={event.id} className="font-semibold text-[#8a5a17]">
              ★ {event.title}
              {event.eventType ? ` (${event.eventType})` : ""}
            </p>
          ))}
        </div>
      ) : null}
      {point.date ? <p className="mt-1 text-[10px] text-[#7c918a]">Click for details</p> : null}
    </div>
  );
}

/** Interactive attendance timeline: monthly (daily) or yearly (monthly) view. */
export function AttendanceTimelinePanel({
  title,
  granularity,
  points,
  showPrevYear,
  showPrevMonth,
  hasPrevYearData,
  hasPrevMonthData,
  selectedDate,
  onSelectDate
}: TimelineProps) {
  const hasData = points.some((point) => point.value > 0 || point.events.length > 0);
  const pointByLabel = new Map(points.map((point) => [point.label, point]));
  const showPrevMonthLine = granularity === "month" && showPrevMonth && hasPrevMonthData;
  const showPrevYearLine = showPrevYear && hasPrevYearData;

  const renderMainDot = (props: {
    cx?: number;
    cy?: number;
    payload?: TimelinePoint;
  }) => {
    const { cx, cy, payload } = props;
    if (cx === undefined || cy === undefined || !payload) return <g />;
    const isEventDay = payload.events.length > 0;
    const isSelected = Boolean(selectedDate) && payload.date === selectedDate;

    if (isSelected) {
      return (
        <circle cx={cx} cy={cy} r={7} fill="#ffffff" stroke="#0f766e" strokeWidth={2.5} />
      );
    }
    if (isEventDay) {
      return (
        <circle cx={cx} cy={cy} r={5.5} fill={EVENT_DOT_COLOR} stroke={EVENT_DOT_STROKE} strokeWidth={1.5} />
      );
    }
    return <circle cx={cx} cy={cy} r={3.5} fill="#0f766e" strokeWidth={0} />;
  };

  return (
    <section className="analytics-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-[var(--font-heading)] text-lg text-[#24362f]">{title}</h3>
        <p className="text-[11px] text-[#5d736a]">Unique attendees (distinct people)</p>
      </div>
      {!hasData ? (
        <p className="mt-3 text-sm text-[#5d736a]">No attendance to plot for this period.</p>
      ) : (
        <>
          <div className="mt-3 h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={points}
                margin={{ top: 16, right: 18, bottom: 4, left: -14 }}
                onClick={(state) => {
                  const payload = (state as { activePayload?: Array<{ payload?: TimelinePoint }> })
                    ?.activePayload?.[0]?.payload;
                  if (payload?.date) onSelectDate(payload.date);
                }}
                style={{ cursor: granularity === "month" ? "pointer" : "default" }}
              >
                <CartesianGrid stroke={GRID_STROKE} strokeDasharray="4 4" vertical={false} />
                <XAxis dataKey="label" tick={AXIS_TICK} tickMargin={8} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} tick={AXIS_TICK} />
                <Tooltip
                  content={<TimelineTooltip pointByLabel={pointByLabel} />}
                  cursor={{ stroke: "#98b6aa", strokeWidth: 1 }}
                />
                {showPrevYearLine ? (
                  <Line
                    type="monotone"
                    dataKey="prevYearValue"
                    name="Previous year"
                    stroke={PREV_YEAR_COLOR}
                    strokeDasharray="6 4"
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ) : null}
                {showPrevMonthLine ? (
                  <Line
                    type="monotone"
                    dataKey="prevMonthValue"
                    name="Previous month"
                    stroke={PREV_MONTH_COLOR}
                    strokeDasharray="4 4"
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ) : null}
                <Line
                  type="monotone"
                  dataKey="value"
                  name="Selected period"
                  stroke="#0f766e"
                  strokeWidth={2.5}
                  dot={renderMainDot}
                  activeDot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#4f675e]">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-5 rounded-full bg-[#0f766e]" /> Selected period
            </span>
            {showPrevYear ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-5 rounded-full border-t-2 border-dashed border-[#94a3b8]" />
                Previous year {hasPrevYearData ? "" : "(no data for this period)"}
              </span>
            ) : null}
            {granularity === "month" && showPrevMonth ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-5 rounded-full border-t-2 border-dashed border-[#f59e0b]" />
                Previous month {hasPrevMonthData ? "" : "(no data for this period)"}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#f59e0b] ring-1 ring-[#b45309]" /> Event day
            </span>
            {granularity === "month" ? (
              <span className="text-[#7c918a]">Click a point to see that day&apos;s details.</span>
            ) : (
              <span className="text-[#7c918a]">Switch to Month view to open day details.</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function GroupedTooltip({
  active,
  payload,
  label
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-xl border border-[#c3d0cb] bg-white/95 px-3 py-2 text-xs shadow-[0_10px_24px_rgba(56,91,79,0.18)]">
      <p className="font-semibold text-[#315349]">{label}</p>
      {payload.map((item) => (
        <p key={String(item.dataKey)} className="mt-0.5 text-[#4f675e]">
          {item.name}: <span className="font-semibold text-[#315349]">{item.value}</span>
        </p>
      ))}
    </div>
  );
}

/** Grouped bar comparison — used for event-to-event comparison. */
export function GroupedBarsPanel({
  title,
  note,
  data,
  series,
  emptyText
}: {
  title: string;
  note?: string;
  data: Array<Record<string, string | number>>;
  series: GroupedSeries[];
  emptyText: string;
}) {
  const hasData = data.length > 0;

  return (
    <section className="analytics-panel">
      <h3 className="font-[var(--font-heading)] text-lg text-[#24362f]">{title}</h3>
      {note ? <p className="mt-1 text-[11px] text-[#5d736a]">{note}</p> : null}
      {!hasData ? (
        <p className="mt-3 text-sm text-[#5d736a]">{emptyText}</p>
      ) : (
        <div className="mt-4 h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 18, right: 16, bottom: 4, left: -14 }}>
              <CartesianGrid stroke={GRID_STROKE} strokeDasharray="4 4" vertical={false} />
              <XAxis
                dataKey="name"
                tick={AXIS_TICK}
                tickMargin={8}
                interval={0}
                angle={data.length > 2 ? -12 : 0}
                textAnchor={data.length > 2 ? "end" : "middle"}
                height={data.length > 2 ? 54 : 34}
              />
              <YAxis allowDecimals={false} tick={AXIS_TICK} />
              <Tooltip content={<GroupedTooltip />} cursor={{ fill: "rgba(56,91,79,0.06)" }} />
              <Legend
                verticalAlign="top"
                align="right"
                iconType="circle"
                formatter={(value) => <span className="text-[11px] font-semibold text-[#496359]">{value}</span>}
              />
              {series.map((entry) => (
                <Bar
                  key={entry.key}
                  dataKey={entry.key}
                  name={entry.name}
                  fill={entry.color}
                  radius={[6, 6, 0, 0]}
                  maxBarSize={44}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
