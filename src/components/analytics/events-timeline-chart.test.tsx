// Rendering tests for the "Compare with last year" overlay.
// Regression case: with dot={false} + connectNulls={false}, recharts 3 renders
// nothing for isolated previous-year points (the usual month-view situation —
// Sundays drift across the calendar), so the overlay appeared broken even
// though the data was passed in. The fix gives the line visible markers.

import { cloneElement, type ReactElement } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EventsTimelineChart, type EventChartPoint } from "./events-timeline-chart";

// ResponsiveContainer measures the parent node, which jsdom leaves at 0x0.
// Pass a fixed size straight to the chart so it renders fully.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
      cloneElement(children, { width: 800, height: 320 })
  };
});

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;

const PREV_COLOR = "#94a3b8";

function point(
  key: string,
  label: string,
  value: number,
  prevValue: number | null
): EventChartPoint {
  return {
    key,
    label,
    fullLabel: key,
    value,
    prevValue,
    events: [],
    clickHint: "Click for details",
    selected: false
  };
}

// Year-view shape: previous year has data only in Aug–Oct.
const yearPoints: EventChartPoint[] = [
  point("2025-01", "Jan", 0, null),
  point("2025-02", "Feb", 0, null),
  point("2025-03", "Mar", 10, null),
  point("2025-04", "Apr", 0, null),
  point("2025-05", "May", 0, null),
  point("2025-06", "Jun", 0, null),
  point("2025-07", "Jul", 0, null),
  point("2025-08", "Aug", 150, 140),
  point("2025-09", "Sep", 160, 145),
  point("2025-10", "Oct", 200, 210),
  point("2025-11", "Nov", 120, null),
  point("2025-12", "Dec", 0, null)
];

describe("EventsTimelineChart — compare with last year", () => {
  it("draws the dashed previous-year line and a marker per previous-year value", () => {
    const { container } = render(
      <EventsTimelineChart
        title="Church attendance — 2025"
        granularity="year"
        points={yearPoints}
        showPrevYear
        hasPrevYearData
        onSelectPoint={() => {}}
      />
    );

    const prevPaths = container.querySelectorAll(`path[stroke="${PREV_COLOR}"]`);
    expect(prevPaths.length).toBeGreaterThanOrEqual(1);
    expect(prevPaths[0].getAttribute("stroke-dasharray")).toBeTruthy();

    // One visible marker for each month where last year has data (Aug, Sep, Oct).
    const prevDots = container.querySelectorAll(`circle[stroke="${PREV_COLOR}"]`);
    expect(prevDots.length).toBe(3);
  });

  it("still shows a marker when the previous year has a single isolated point", () => {
    // Month view: weekdays drift, so often exactly one day lines up (e.g. an
    // anniversary on the same date both years). The overlay must be visible.
    const monthPoints: EventChartPoint[] = [
      point("2025-10-04", "4", 196, 208),
      point("2025-10-05", "5", 114, null),
      point("2025-10-12", "12", 108, null),
      point("2025-10-19", "19", 132, null)
    ];

    const { container } = render(
      <EventsTimelineChart
        title="Church attendance — October 2025"
        granularity="month"
        points={monthPoints}
        showPrevYear
        hasPrevYearData
        onSelectPoint={() => {}}
      />
    );

    expect(container.querySelectorAll(`circle[stroke="${PREV_COLOR}"]`).length).toBe(1);
  });

  it("returns to the current-year-only view when toggled off", () => {
    const { container } = render(
      <EventsTimelineChart
        title="Church attendance — 2025"
        granularity="year"
        points={yearPoints}
        showPrevYear={false}
        hasPrevYearData
        onSelectPoint={() => {}}
      />
    );

    expect(container.querySelectorAll(`path[stroke="${PREV_COLOR}"]`).length).toBe(0);
    expect(container.querySelectorAll(`circle[stroke="${PREV_COLOR}"]`).length).toBe(0);
  });

  it("labels both years in the legend and flags when last year has no data", () => {
    const { container } = render(
      <EventsTimelineChart
        title="Church attendance — 2026"
        granularity="year"
        points={yearPoints}
        showPrevYear
        hasPrevYearData={false}
        onSelectPoint={() => {}}
      />
    );

    expect(container.textContent).toContain("Attendance 2025");
    expect(container.textContent).toContain("Same period last year 2024");
    expect(container.textContent).toContain("(no data yet)");
    expect(container.querySelectorAll(`path[stroke="${PREV_COLOR}"]`).length).toBe(0);
  });
});
