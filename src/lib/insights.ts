// P7 — Automated insights engine.
// Every rule is evidence-based with stated windows and minimum thresholds:
// the engine flags changes worth an administrator's review and never draws
// conclusions about people or events. Computed fresh on dashboard load —
// the database views and live data are always the source of truth.

import { toLocalDateInput } from "@/lib/date";
import type { EventFeedbackSummary } from "@/components/event-feedback";

// Thresholds — named so they can be tuned or made configurable later.
export const INSIGHT_ATTENDANCE_DROP_PCT = 20;
export const INSIGHT_MIN_CHECKINS_PER_WINDOW = 5;
export const INSIGHT_MEMBER_INACTIVE_DAYS = 21;
export const INSIGHT_MEMBER_BASELINE_MIN = 2;
export const INSIGHT_MEMBER_BASELINE_DAYS = 60;
export const INSIGHT_LOW_RATING = 3.5;
export const INSIGHT_MIN_RESPONSES = 5;

export type InsightKind =
  | "attendance-drop"
  | "member-decline"
  | "low-rating"
  | "recurring-weak"
  | "data-quality";

export type Insight = {
  id: string;
  kind: InsightKind;
  title: string;
  detail: string;
  window: string;
  severity: "review" | "info";
  href?: string;
};

export type InsightAttendanceRow = {
  student_id: string;
  attendance_context: string | null;
  attendance_group: string | null;
  attended_date: string;
};

const DAY_MS = 86_400_000;

function isoDaysAgo(todayIso: string, days: number): string {
  const date = new Date(`${todayIso}T00:00:00`);
  date.setDate(date.getDate() - days);
  return toLocalDateInput(date);
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (new Date(`${toIso}T00:00:00`).getTime() - new Date(`${fromIso}T00:00:00`).getTime()) / DAY_MS
  );
}

function bucketOf(row: InsightAttendanceRow): string | null {
  // Normalize legacy values the same way the rest of the app does.
  const group =
    row.attendance_group === "Male"
      ? "Men's Network"
      : row.attendance_group === "Female"
        ? "Women's Network"
        : row.attendance_group;
  if (group && group.length > 0) return group;
  return null;
}

/** 1. Week-over-week attendance drops per attendance group. */
export function attendanceDropInsights(rows: InsightAttendanceRow[], todayIso: string): Insight[] {
  const curFrom = isoDaysAgo(todayIso, 6);
  const curTo = todayIso;
  const prevFrom = isoDaysAgo(todayIso, 13);
  const prevTo = isoDaysAgo(todayIso, 7);

  const cur = new Map<string, number>();
  const prev = new Map<string, number>();
  for (const row of rows) {
    const bucket = bucketOf(row);
    if (!bucket) continue;
    if (row.attended_date >= curFrom && row.attended_date <= curTo) {
      cur.set(bucket, (cur.get(bucket) ?? 0) + 1);
    } else if (row.attended_date >= prevFrom && row.attended_date <= prevTo) {
      prev.set(bucket, (prev.get(bucket) ?? 0) + 1);
    }
  }

  const insights: Insight[] = [];
  const buckets = new Set([...cur.keys(), ...prev.keys()]);
  for (const bucket of buckets) {
    const prevCount = prev.get(bucket) ?? 0;
    const curCount = cur.get(bucket) ?? 0;
    if (prevCount < INSIGHT_MIN_CHECKINS_PER_WINDOW) continue;
    const dropPct = Math.round(((prevCount - curCount) / prevCount) * 100);
    if (dropPct < INSIGHT_ATTENDANCE_DROP_PCT) continue;
    insights.push({
      id: `drop-${bucket}`,
      kind: "attendance-drop",
      title: `${bucket}: attendance down ${dropPct}% this week`,
      detail: `Check-ins fell from ${prevCount} to ${curCount} compared with the previous seven days.`,
      window: "Last 7 days vs the previous 7 days (minimum 5 check-ins in the earlier window)",
      severity: "review",
      href: "/records"
    });
  }
  return insights;
}

/** 2. Members inactive well past their own recent baseline. */
export function memberDeclineInsights(rows: InsightAttendanceRow[], todayIso: string): Insight[] {
  const baselineFrom = isoDaysAgo(todayIso, INSIGHT_MEMBER_INACTIVE_DAYS + INSIGHT_MEMBER_BASELINE_DAYS);
  const baselineTo = isoDaysAgo(todayIso, INSIGHT_MEMBER_INACTIVE_DAYS);

  const lastSeen = new Map<string, string>();
  const names = new Map<string, string>();
  const baselineCounts = new Map<string, number>();

  for (const row of rows) {
    names.set(row.student_id, names.get(row.student_id) ?? row.student_id);
    const last = lastSeen.get(row.student_id);
    if (!last || row.attended_date > last) lastSeen.set(row.student_id, row.attended_date);
    if (row.attended_date >= baselineFrom && row.attended_date <= baselineTo) {
      baselineCounts.set(row.student_id, (baselineCounts.get(row.student_id) ?? 0) + 1);
    }
  }

  const flagged: Array<{ id: string; name: string; gapDays: number; lastDate: string; baseline: number }> = [];
  for (const [studentId, lastDate] of lastSeen) {
    const gapDays = daysBetween(lastDate, todayIso);
    if (gapDays <= INSIGHT_MEMBER_INACTIVE_DAYS) continue;
    const baseline = baselineCounts.get(studentId) ?? 0;
    if (baseline < INSIGHT_MEMBER_BASELINE_MIN) continue;
    flagged.push({
      id: studentId,
      name: names.get(studentId) ?? studentId,
      gapDays,
      lastDate,
      baseline
    });
  }

  flagged.sort((a, b) => b.gapDays - a.gapDays);
  const insights: Insight[] = flagged.slice(0, 6).map((entry) => ({
    id: `member-${entry.id}`,
    kind: "member-decline",
    title: `${entry.name}: no attendance in ${entry.gapDays} days`,
    detail: `Last recorded on ${entry.lastDate}. They attended ${entry.baseline} times in the ${INSIGHT_MEMBER_BASELINE_DAYS} days before that gap — a change from their own recent pattern. Worth a personal check-in.`,
    window: `Inactive ${INSIGHT_MEMBER_INACTIVE_DAYS}+ days with ${INSIGHT_MEMBER_BASELINE_MIN}+ attendances in the prior ${INSIGHT_MEMBER_BASELINE_DAYS} days`,
    severity: "review",
    href: "/members"
  }));

  if (flagged.length > 6) {
    insights.push({
      id: "member-more",
      kind: "member-decline",
      title: `${flagged.length - 6} more members on the watch list`,
      detail: "Open the Members page and sort by last attendance to see the full list.",
      window: `Inactive ${INSIGHT_MEMBER_INACTIVE_DAYS}+ days with ${INSIGHT_MEMBER_BASELINE_MIN}+ attendances in the prior ${INSIGHT_MEMBER_BASELINE_DAYS} days`,
      severity: "info",
      href: "/members"
    });
  }
  return insights;
}

/** 3. Events whose overall rating is low once enough responses exist. */
export function lowRatingInsights(
  summaries: EventFeedbackSummary[],
  titleById: Record<string, string>
): Insight[] {
  const insights: Insight[] = [];
  for (const summary of summaries) {
    const responses = summary.total_responses ?? 0;
    const avg = summary.avg_overall_rating ?? null;
    if (responses < INSIGHT_MIN_RESPONSES || avg === null || avg > INSIGHT_LOW_RATING) continue;
    const title = titleById[summary.event_id] ?? "An event";
    insights.push({
      id: `rating-${summary.event_id}`,
      kind: "low-rating",
      title: `${title} averaged ${avg.toFixed(2)}★`,
      detail: `${responses} responses — at or below the ${INSIGHT_LOW_RATING.toFixed(1)}★ review threshold. Read the comments in Events before deciding what to change.`,
      window: `Event ratings with at least ${INSIGHT_MIN_RESPONSES} responses`,
      severity: "review",
      href: "/events-manager"
    });
  }
  return insights;
}

/** 4. Categories rated ≤ threshold across two or more sufficiently-answered events. */
export function recurringWeakSummaryInsights(
  summaries: EventFeedbackSummary[],
  titleById: Record<string, string>
): Insight[] {
  const categories: Array<{ label: string; avgKey: keyof EventFeedbackSummary }> = [
    { label: "Food", avgKey: "avg_food_rating" },
    { label: "Venue", avgKey: "avg_venue_rating" },
    { label: "Music", avgKey: "avg_music_rating" },
    { label: "Program", avgKey: "avg_program_rating" },
    { label: "Staff", avgKey: "avg_staff_rating" },
    { label: "Speaker", avgKey: "avg_speaker_rating" }
  ];

  const eligible = summaries.filter((summary) => (summary.total_responses ?? 0) >= INSIGHT_MIN_RESPONSES);
  if (eligible.length < 2) return [];

  const insights: Insight[] = [];
  for (const category of categories) {
    const weak = eligible.filter((summary) => {
      const avg = summary[category.avgKey];
      return typeof avg === "number" && avg <= INSIGHT_LOW_RATING;
    });
    if (weak.length < 2) continue;
    const names = weak
      .map((summary) => titleById[summary.event_id] ?? "An event")
      .slice(0, 4)
      .join(", ");
    insights.push({
      id: `weak-${category.avgKey}`,
      kind: "recurring-weak",
      title: `${category.label} rated ${INSIGHT_LOW_RATING.toFixed(1)}★ or lower in ${weak.length} events`,
      detail: `Events with enough responses: ${names}. A recurring pattern worth investigating before the next event of this type.`,
      window: `Event ratings with at least ${INSIGHT_MIN_RESPONSES} responses`,
      severity: "review",
      href: "/events-manager"
    });
  }
  return insights;
}

/** 5. Data-quality observations (legacy rows, weekday-dated Sunday records). */
export function dataQualityInsights(rows: InsightAttendanceRow[]): Insight[] {
  const insights: Insight[] = [];

  const legacy = rows.filter((row) => row.attendance_context === "Events").length;
  if (legacy > 0) {
    insights.push({
      id: "legacy-context",
      kind: "data-quality",
      title: `${legacy} attendance records use a retired attendance type`,
      detail: "These rows carry the legacy 'Events' context. The analytics normalize them into their networks, but a data cleanup would keep reports consistent.",
      window: "Whole visible history",
      severity: "info",
      href: "/records"
    });
  }

  const weekdaySundays = rows.filter((row) => {
    if (row.attendance_context !== "Sunday Service") return false;
    const day = new Date(`${row.attended_date}T00:00:00`).getDay();
    return day !== 0;
  }).length;
  if (weekdaySundays > 0) {
    insights.push({
      id: "weekday-sundays",
      kind: "data-quality",
      title: `${weekdaySundays} Sunday Service records are dated on a weekday`,
      detail: "Either special weekday services took place or some scans were labeled as Sunday Service. Worth verifying — these dates count as attendance occasions.",
      window: "Whole visible history",
      severity: "info",
      href: "/records"
    });
  }
  return insights;
}
