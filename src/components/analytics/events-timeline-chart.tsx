"use client";

// Simplified Events analytics timeline (P8).
// One interactive chart: hover for the summary, click a point to open that
// month (year view) or that day's details (month view). Optional dashed
// overlay of the same period last year.

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

export type EventChartEventMarker = {
  id: string;
  title: string;
  eventType: string | null;
};

export type EventChartPoint = {
  key: string;
  label: string;
  fullLabel: string;
  value: number;
  prevValue: number | null;
  events: EventChartEventMarker[];
  clickHint: string | null;
  selected: boolean;
};

type TooltipPayloadItem = {
  value?: number | string;
};

const AXIS_TICK = { fill: "#5d736a", fontSize: 11 };
const GRID_STROKE = "#d5dfdb";
const MAIN_COLOR = "#0f766e";
const PREV_COLOR = "#94a3b8";
const EVENT_DOT_COLOR = "#f59e0b";
const EVENT_DOT_STROKE = "#b45309";

function TimelineTooltip({
  active,
  payload,
  label,
  pointByLabel
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
  pointByLabel?: Map<string, EventChartPoint>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = pointByLabel?.get(String(label));
  if (!point) return null;

  return (
    <div className="max-w-[280px] rounded-xl border border-[#c3d0cb] bg-white/95 px-3 py-2 text-xs shadow-[0_10px_24px_rgba(56,91,79,0.18)]">
      <p className="font-semibold text-[#315349]">{point.fullLabel}</p>
      <p className="mt-0.5 text-[#4f675e]">
        Attendance: <span className="font-semibold text-[#315349]">{point.value}</span>
        {point.value === 1 ? " attendee" : " attendees"}
      </p>
      {point.prevValue !== null ? (
        <p className="text-[#64748b]">
          Same period last year: <span className="font-semibold">{point.prevValue}</span>
        </p>
      ) : null}
      {point.events.length > 0 ? (
        <div className="mt-1 border-t border-[#e2e8e5] pt-1">
          {point.events.slice(0, 4).map((event) => (
            <p key={event.id} className="font-semibold text-[#8a5a17]">
              ★ {event.title}
              {event.eventType ? ` (${event.eventType})` : ""}
            </p>
          ))}
          {point.events.length > 4 ? (
            <p className="text-[10px] text-[#7c918a]">+{point.events.length - 4} more</p>
          ) : null}
        </div>
      ) : null}
      {point.clickHint ? <p className="mt-1 text-[10px] text-[#7c918a]">{point.clickHint}</p> : null}
    </div>
  );
}

export function EventsTimelineChart({
  title,
  note,
  granularity,
  points,
  showPrevYear,
  hasPrevYearData,
  onSelectPoint
}: {
  title: string;
  note: string;
  granularity: "year" | "month";
  points: EventChartPoint[];
  showPrevYear: boolean;
  hasPrevYearData: boolean;
  onSelectPoint: (point: EventChartPoint) => void;
}) {
  const hasData = points.some((point) => point.value > 0 || point.events.length > 0);
  const pointByLabel = new Map(points.map((point) => [point.label, point]));
  const showPrevLine = showPrevYear && hasPrevYearData;

  const renderMainDot = (props: { cx?: number; cy?: number; payload?: EventChartPoint }) => {
    const { cx, cy, payload } = props;
    if (cx === undefined || cy === undefined || !payload) return <g />;
    if (payload.selected) {
      return <circle cx={cx} cy={cy} r={7} fill="#ffffff" stroke={MAIN_COLOR} strokeWidth={2.5} />;
    }
    if (payload.events.length > 0) {
      return <circle cx={cx} cy={cy} r={5.5} fill={EVENT_DOT_COLOR} stroke={EVENT_DOT_STROKE} strokeWidth={1.5} />;
    }
    return <circle cx={cx} cy={cy} r={3.5} fill={MAIN_COLOR} strokeWidth={0} />;
  };

  return (
    <section className="analytics-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-[var(--font-heading)] text-lg text-[#24362f]">{title}</h3>
        <p className="text-[11px] text-[#5d736a]">{note}</p>
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
                  const payload = (state as { activePayload?: Array<{ payload?: EventChartPoint }> })?.activePayload?.[0]
                    ?.payload;
                  if (payload && payload.clickHint) onSelectPoint(payload);
                }}
                style={{ cursor: "pointer" }}
              >
                <CartesianGrid stroke={GRID_STROKE} strokeDasharray="4 4" vertical={false} />
                <XAxis dataKey="label" tick={AXIS_TICK} tickMargin={8} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} tick={AXIS_TICK} />
                <Tooltip
                  content={<TimelineTooltip pointByLabel={pointByLabel} />}
                  cursor={{ stroke: "#98b6aa", strokeWidth: 1 }}
                />
                {showPrevLine ? (
                  <Line
                    type="monotone"
                    dataKey="prevValue"
                    name="Same period last year"
                    stroke={PREV_COLOR}
                    strokeDasharray="6 4"
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ) : null}
                <Line
                  type="monotone"
                  dataKey="value"
                  name="Attendance"
                  stroke={MAIN_COLOR}
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
              <span className="inline-block h-0.5 w-5 rounded-full bg-[#0f766e]" /> Attendance
            </span>
            {showPrevYear ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-5 rounded-full border-t-2 border-dashed border-[#94a3b8]" />
                Same period last year {hasPrevYearData ? "" : "(no data yet)"}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#f59e0b] ring-1 ring-[#b45309]" /> Event day
            </span>
            <span className="text-[#7c918a]">
              {granularity === "year"
                ? "Click a month to drill into it. Hover a point to see what happened."
                : "Click a point to see that day's details below."}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
