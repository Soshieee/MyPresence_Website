// Shared helper for reading a clicked point off a recharts 3 timeline.
// The recharts ^3.10 upgrade replaced the recharts 2 event state: chart-level
// handlers now receive MouseHandlerDataParam, which has no `activePayload`.
// The clicked point is resolved through the x-axis label (`activeLabel`) —
// exactly the value the Tooltip content already receives as `label` — so the
// analytics timelines and their tooltips can never disagree about which
// column was clicked. Used by the Events and Lifegroup charts.

import type { MouseHandlerDataParam } from "recharts";

export function activeChartLabel(state: MouseHandlerDataParam | null | undefined): string | null {
  const label = state?.activeLabel;
  if (label === undefined || label === null || label === "") return null;
  return String(label);
}
