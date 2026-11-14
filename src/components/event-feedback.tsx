"use client";

// P4 — Event Feedback components: admin analytics for the web.
// Rating/submission lives in the HPCI Thrive mobile app; the web is
// read-only (aggregate analytics + comments for administrators).
// The database (event_feedback + event_feedback_summary) is the source of
// truth; this module reads it defensively and degrades gracefully when parts
// are unreadable.

import { useMemo } from "react";
import { GroupedBarsPanel } from "@/components/attendance-charts";

function formatDay(value: string | null): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}/${String(
    date.getFullYear()
  ).slice(-2)}`;
}

// ---------------------------------------------------------------------------
// Shared vocabulary + evidence thresholds
// ---------------------------------------------------------------------------

export const FEEDBACK_CATEGORIES = [
  { key: "food_rating", label: "Food" },
  { key: "venue_rating", label: "Venue" },
  { key: "music_rating", label: "Music" },
  { key: "program_rating", label: "Program" },
  { key: "staff_rating", label: "Staff" },
  { key: "speaker_rating", label: "Speaker" }
] as const;

export type FeedbackCategoryKey = (typeof FEEDBACK_CATEGORIES)[number]["key"];

export type EventFeedbackRow = {
  id: string;
  event_id: string;
  user_id: string;
  overall_rating: number;
  comment: string | null;
  author_display_name: string | null;
  author_avatar_url?: string | null;
  created_at: string;
  updated_at?: string | null;
  food_rating?: number | null;
  venue_rating?: number | null;
  music_rating?: number | null;
  program_rating?: number | null;
  staff_rating?: number | null;
  speaker_rating?: number | null;
};

export type EventFeedbackSummary = {
  event_id: string;
  total_responses: number;
  first_response_day?: string | null;
  last_activity_day?: string | null;
  avg_overall_rating?: number | null;
  avg_food_rating?: number | null;
  avg_venue_rating?: number | null;
  avg_music_rating?: number | null;
  avg_program_rating?: number | null;
  avg_staff_rating?: number | null;
  avg_speaker_rating?: number | null;
  food_responses?: number | null;
  venue_responses?: number | null;
  music_responses?: number | null;
  program_responses?: number | null;
  staff_responses?: number | null;
  speaker_responses?: number | null;
};

// ---------------------------------------------------------------------------
// Tolerant summary readers
// ---------------------------------------------------------------------------

/**
 * PostgREST serializes `count()` aggregates (int8) as JSON strings to avoid
 * precision loss, while avg() (numeric) arrives as a number — and some
 * deployments return numerics as strings too. Read both shapes defensively;
 * null means "this value is not usable" (missing column, N/A, unparsable).
 */
export function summaryNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Average for one feedback factor ("food_rating" -> view column avg_food_rating). */
export function feedbackCategoryAverage(
  summary: EventFeedbackSummary | undefined | null,
  key: string
): number | null {
  if (!summary) return null;
  const record = summary as unknown as Record<string, unknown>;
  return summaryNumber(record[`avg_${key}`]);
}

/**
 * Response count for one feedback factor ("food_rating" -> food_responses).
 * null means the count is unknown (the summary view predates the per-category
 * count columns); a number — including 0 — is authoritative.
 */
export function feedbackCategoryResponses(
  summary: EventFeedbackSummary | undefined | null,
  key: string
): number | null {
  if (!summary) return null;
  const record = summary as unknown as Record<string, unknown>;
  return summaryNumber(record[key.replace("_rating", "_responses")]);
}

// Evidence thresholds: flags require enough responses before they mean anything.
export const FEEDBACK_MIN_RESPONSES = 5;
export const FEEDBACK_OUTLIER_GAP = 0.75;
export const FEEDBACK_WEAK_AVG = 3.5;

// ---------------------------------------------------------------------------
// Statistics aggregation (from raw rows; falls back to the summary view)
// ---------------------------------------------------------------------------

export type FeedbackStats = {
  total: number;
  overallAvg: number | null;
  distribution: Array<{ rating: number; count: number }>;
  categories: Array<{ key: string; label: string; avg: number | null; count: number }>;
  comments: Array<{
    id: string;
    author: string;
    rating: number;
    comment: string;
    date: string | null;
    updatedAt: string | null;
  }>;
  firstResponseDay: string | null;
  lastActivityDay: string | null;
};

export function computeFeedbackStats(
  rows: EventFeedbackRow[],
  summary?: EventFeedbackSummary | null
): FeedbackStats {
  const total = rows.length;

  const distribution = [1, 2, 3, 4, 5].map((rating) => ({
    rating,
    count: rows.filter((row) => row.overall_rating === rating).length
  }));

  // Category averages and response counts come from raw rows when readable;
  // when they are not, the summary view's per-category values are used. Both
  // paths exclude N/A (NULL) ratings by definition. Summary values are read
  // tolerantly: count() columns arrive as strings via PostgREST (int8), and
  // an average can exist even when its count column is missing (older view).
  const summaryAvgByKey: Partial<Record<FeedbackCategoryKey, number | null>> = summary
    ? {
        food_rating: feedbackCategoryAverage(summary, "food_rating"),
        venue_rating: feedbackCategoryAverage(summary, "venue_rating"),
        music_rating: feedbackCategoryAverage(summary, "music_rating"),
        program_rating: feedbackCategoryAverage(summary, "program_rating"),
        staff_rating: feedbackCategoryAverage(summary, "staff_rating"),
        speaker_rating: feedbackCategoryAverage(summary, "speaker_rating")
      }
    : {};
  const summaryCountByKey: Partial<Record<FeedbackCategoryKey, number | null>> = summary
    ? {
        food_rating: feedbackCategoryResponses(summary, "food_rating"),
        venue_rating: feedbackCategoryResponses(summary, "venue_rating"),
        music_rating: feedbackCategoryResponses(summary, "music_rating"),
        program_rating: feedbackCategoryResponses(summary, "program_rating"),
        staff_rating: feedbackCategoryResponses(summary, "staff_rating"),
        speaker_rating: feedbackCategoryResponses(summary, "speaker_rating")
      }
    : {};

  const categories = FEEDBACK_CATEGORIES.map((category) => {
    const values = rows
      .map((row) => row[category.key] as number | null | undefined)
      .filter((value): value is number => typeof value === "number" && value >= 1 && value <= 5);
    const count = values.length > 0 ? values.length : (summaryCountByKey[category.key] ?? 0);
    const avg =
      values.length > 0
        ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100
        : (summaryAvgByKey[category.key] ?? null);
    return { key: category.key, label: category.label, avg, count };
  });

  const overallAvg =
    total > 0
      ? Math.round((rows.reduce((sum, row) => sum + row.overall_rating, 0) / total) * 100) / 100
      : summaryNumber(summary?.avg_overall_rating);

  const sortedByDate = [...rows].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

  return {
    total: total || (summaryNumber(summary?.total_responses) ?? 0),
    overallAvg,
    distribution,
    categories,
    comments: sortedByDate.map((row) => ({
      id: row.id,
      author: row.author_display_name || "Member",
      rating: row.overall_rating,
      comment: (row.comment ?? "").trim(),
      date: row.created_at ? row.created_at.slice(0, 10) : null,
      updatedAt: row.updated_at ?? null
    })),
    firstResponseDay:
      summary?.first_response_day ??
      (sortedByDate.length > 0 ? sortedByDate[sortedByDate.length - 1].created_at.slice(0, 10) : null),
    lastActivityDay:
      summary?.last_activity_day ?? (sortedByDate.length > 0 ? sortedByDate[0].created_at.slice(0, 10) : null)
  };
}

// ---------------------------------------------------------------------------
// Diagnostics (evidence-gated observations, never conclusions)
// ---------------------------------------------------------------------------

export function categoryOutliers(stats: FeedbackStats): string[] {
  if (stats.total < FEEDBACK_MIN_RESPONSES) return [];
  const scored = stats.categories.filter((category) => category.avg !== null && category.count > 0);
  const observations: string[] = [];
  for (const category of scored) {
    const others = scored.filter((entry) => entry.key !== category.key);
    if (others.length === 0) continue;
    const othersAvg =
      others.reduce((sum, entry) => sum + (entry.avg ?? 0), 0) / others.length;
    if ((category.avg ?? 0) <= othersAvg - FEEDBACK_OUTLIER_GAP) {
      observations.push(
        `${category.label} averaged ${category.avg?.toFixed(2)} — noticeably lower than the other categories (${othersAvg.toFixed(2)} average). Review its comments before drawing conclusions.`
      );
    }
  }
  return observations;
}

export function recurringWeakCategories(
  statsByEvent: Array<{ eventTitle: string; stats: FeedbackStats }>
): string[] {
  const eligible = statsByEvent.filter((entry) => entry.stats.total >= FEEDBACK_MIN_RESPONSES);
  if (eligible.length < 2) return [];
  const observations: string[] = [];
  for (const category of FEEDBACK_CATEGORIES) {
    const weakEvents = eligible.filter((entry) => {
      const match = entry.stats.categories.find((item) => item.key === category.key);
      return match?.avg !== null && match?.count && match.avg <= FEEDBACK_WEAK_AVG;
    });
    if (weakEvents.length >= 2) {
      observations.push(
        `${category.label} averaged ${FEEDBACK_WEAK_AVG.toFixed(1)}★ or lower in ${weakEvents.length} events with at least ${FEEDBACK_MIN_RESPONSES} responses (${weakEvents
          .map((entry) => entry.eventTitle)
          .join(", ")}).`
      );
    }
  }
  return observations;
}

// ---------------------------------------------------------------------------
// Admin presentation pieces
// ---------------------------------------------------------------------------

export function FeedbackDistributionBars({ stats }: { stats: FeedbackStats }) {
  const max = Math.max(...stats.distribution.map((item) => item.count), 1);
  return (
    <div className="grid gap-1.5">
      {[...stats.distribution].reverse().map((item) => (
        <div key={item.rating} className="grid grid-cols-[64px_1fr_44px] items-center gap-2 text-xs">
          <span className="font-semibold text-[#496359]">
            {item.rating} ★{item.rating > 1 ? "s" : ""}
          </span>
          <div className="h-2.5 rounded-full bg-[#e8f0ec]">
            <div
              className="h-2.5 rounded-full bg-[#385b4f]"
              style={{ width: `${(item.count / max) * 100}%` }}
            />
          </div>
          <span className="text-right font-semibold text-[#315349]">{item.count}</span>
        </div>
      ))}
    </div>
  );
}

export function FeedbackCategoryTable({ stats }: { stats: FeedbackStats }) {
  return (
    <table className="w-full min-w-[320px] border-collapse text-left text-sm">
      <thead>
        <tr className="border-b border-[#d6e1dd] text-[10px] uppercase tracking-[0.08em] text-[#71847c]">
          <th className="px-2 py-2">Category</th>
          <th className="px-2 py-2 text-right">Avg</th>
          <th className="px-2 py-2 text-right">Responses</th>
        </tr>
      </thead>
      <tbody>
        {stats.categories.map((category) => (
          <tr key={category.key} className="border-b border-[#edf2ef] last:border-0">
            <td className="px-2 py-2 font-semibold text-[#2f4d43]">{category.label}</td>
            <td className="px-2 py-2 text-right font-semibold text-[#315349]">
              <div>{category.avg === null ? "0.00★" : `${category.avg.toFixed(2)}★`}</div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#e8f0ec]">
                <div
                  className="h-full rounded-full bg-[#385b4f]"
                  style={{ width: `${category.avg === null ? 0 : Math.min(Math.max(category.avg, 0) / 5, 1) * 100}%` }}
                />
              </div>
              {category.count === 0 ? <div className="mt-1 text-[10px] font-normal text-[#7c918a]">No data yet</div> : null}
            </td>
            <td className="px-2 py-2 text-right text-[#5e766c]">{category.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function FeedbackCommentsList({ stats }: { stats: FeedbackStats }) {
  const withComments = stats.comments.filter((entry) => entry.comment.length > 0);
  if (withComments.length === 0) {
    return <p className="text-sm text-[#5d736a]">No written comments for this event.</p>;
  }
  return (
    <div className="grid gap-2">
      {withComments.map((entry) => (
        <div key={entry.id} className="rounded-xl bg-white/85 px-3 py-2">
          <p className="text-xs font-semibold text-[#315349]">
            {entry.author} • {entry.rating}★
            {entry.date ? ` • ${formatDay(entry.date)}` : ""}
            {entry.updatedAt && entry.date && entry.updatedAt.slice(0, 10) !== entry.date ? " • edited" : ""}
          </p>
          {entry.comment ? <p className="mt-1 text-sm text-[#3e5850]">{entry.comment}</p> : null}
        </div>
      ))}
    </div>
  );
}

/** Feedback-to-Attendance Count Ratio — counts-based estimate, per Decision #2. */
export function feedbackAttendanceRatioLabel(
  responses: number,
  distinctAttendees: number | null
): string {
  if (distinctAttendees === null || distinctAttendees === 0) {
    return "Not computable — no linked attendance records for this event";
  }
  const ratio = (responses / distinctAttendees) * 100;
  return `${responses} / ${distinctAttendees} attendees = ${Math.round(ratio * 10) / 10}% (counts-based estimate)`;
}

/** Event-to-event comparison across the seven averages (shared 1–5 scale). */
export function FeedbackComparisonPanel({
  selection,
  statsByEvent
}: {
  selection: Array<{ id: string; title: string; responses: number }>;
  statsByEvent: Map<string, FeedbackStats>;
}) {
  const series = selection.map((event, index) => ({
    key: event.id,
    name: `${event.title} (${event.responses} resp.)`,
    color: ["#0f766e", "#2563eb", "#f59e0b"][index % 3]
  }));

  const rows = ["Overall", ...FEEDBACK_CATEGORIES.map((category) => category.label)].map((label) => {
    const row: Record<string, string | number> = { name: label };
    for (const event of selection) {
      const stats = statsByEvent.get(event.id);
      let value: number | null = null;
      if (stats) {
        if (label === "Overall") value = stats.overallAvg;
        else value = stats.categories.find((category) => category.label === label)?.avg ?? null;
      }
      row[event.id] = value === null ? 0 : value;
    }
    return row;
  });

  return (
    <GroupedBarsPanel
      title="Event Feedback Comparison"
      note="All values use the shared 1–5★ scale. Events with fewer than 5 responses are not representative — compare with care."
      data={rows}
      series={series}
      emptyText="Select up to 3 events above to compare their feedback."
    />
  );
}

// ---------------------------------------------------------------------------
// Admin card for the events manager (per selected event + comparison overview)
// ---------------------------------------------------------------------------

export function FeedbackAdminCard({
  stats,
  attendees,
  status,
  notice,
  events,
  compareIds,
  statsByEvent,
  recurringWeak,
  minResponses,
  event,
  onRefresh,
  onPrint,
  onToggleCompare,
  onClearCompare
}: {
  event: { id: string; title: string; event_date: string | null };
  stats: FeedbackStats | null;
  attendees: number | null;
  status: "idle" | "loading" | "ready" | "partial" | "error";
  notice: string;
  events: Array<{ id: string; title: string; event_date: string | null }>;
  compareIds: string[];
  statsByEvent: Map<string, FeedbackStats>;
  recurringWeak: string[];
  minResponses: number;
  onRefresh: () => void;
  onPrint: () => void;
  onToggleCompare: (eventId: string) => void;
  onClearCompare: () => void;
}) {
  const outlierNotes = useMemo(() => (stats ? categoryOutliers(stats) : []), [stats]);

  return (
    <div className="rounded-2xl border border-[#bdd0c9] bg-white/85 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-[var(--font-heading)] text-lg text-[#23332d]">Event Feedback — {event.title}</h3>
          <p className="mt-1 text-xs text-[#5e766c]">
            What members said about this event. N/A ratings are excluded from category averages.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={onRefresh} disabled={status === "loading"}>
            {status === "loading" ? "Refreshing..." : "Refresh"}
          </button>
          <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={onPrint} disabled={!stats}>
            Print Report
          </button>
        </div>
      </div>

      {status === "loading" ? <p className="mt-3 status-info">Loading feedback...</p> : null}
      {status === "error" ? <p className="mt-3 status-error">{notice}</p> : null}
      {notice && status !== "error" ? <p className="mt-3 status-info">{notice}</p> : null}

      {stats ? (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl bg-[#f7fbf9] px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#527064]">Total Responses</p>
              <p className="font-[var(--font-heading)] text-2xl text-[#22332d]">{stats.total}</p>
            </div>
            <div className="rounded-xl bg-[#f7fbf9] px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#527064]">Avg Overall</p>
              <p className="font-[var(--font-heading)] text-2xl text-[#22332d]">
                {stats.overallAvg === null ? "—" : `${stats.overallAvg.toFixed(2)}★`}
              </p>
            </div>
            <div className="rounded-xl bg-[#f7fbf9] px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#527064]">Response Window</p>
              <p className="text-sm font-semibold text-[#315349]">
                {stats.firstResponseDay ?? "—"} → {stats.lastActivityDay ?? "—"}
              </p>
            </div>
            <div className="rounded-xl bg-[#f7fbf9] px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#527064]">
                Feedback-to-Attendance
              </p>
              <p className="text-sm font-semibold text-[#315349]">
                {feedbackAttendanceRatioLabel(stats.total, attendees)}
              </p>
            </div>
          </div>

          {stats.total === 0 ? (
            <p className="mt-3 text-sm text-[#5d736a]">
              No feedback submitted for this event yet. Members can rate past events from the Home dashboard.
            </p>
          ) : (
            <>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div>
                  <p className="field-label">Overall Rating Distribution</p>
                  <div className="mt-2">
                    <FeedbackDistributionBars stats={stats} />
                  </div>
                </div>
                <div>
                  <p className="field-label">Category Performance</p>
                  <div className="mt-2">
                    <FeedbackCategoryTable stats={stats} />
                  </div>
                </div>
              </div>

              {outlierNotes.length > 0 ? (
                <div className="mt-3 rounded-xl border border-[#e5cf93] bg-[#fffaf0] px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#7a5a17]">
                    Observations (requires at least {minResponses} responses)
                  </p>
                  <ul className="mt-1 list-disc pl-5 text-xs text-[#6a5a2a]">
                    {outlierNotes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="mt-4">
                <p className="field-label">Written Comments</p>
                <div className="mt-2">
                  <FeedbackCommentsList stats={stats} />
                </div>
              </div>
            </>
          )}

          <div className="mt-5 border-t border-[#e2e8e5] pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="field-label">Compare Events</p>
              {compareIds.length > 0 ? (
                <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={onClearCompare}>
                  Clear selection
                </button>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {events.map((entry) => {
                const active = compareIds.includes(entry.id);
                const disabled = !active && compareIds.length >= 3;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    disabled={disabled}
                    className={active ? "btn-primary px-3 py-1.5 text-xs" : "btn-ghost px-3 py-1.5 text-xs"}
                    onClick={() => onToggleCompare(entry.id)}
                  >
                    {entry.title}
                    {entry.event_date ? ` · ${entry.event_date}` : ""}
                  </button>
                );
              })}
            </div>
            <div className="mt-3">
              <FeedbackComparisonPanel
                selection={compareIds
                  .map((id) => {
                    const match = events.find((entry) => entry.id === id);
                    if (!match) return null;
                    return {
                      id: match.id,
                      title: match.title,
                      responses: statsByEvent.get(match.id)?.total ?? 0
                    };
                  })
                  .filter((entry): entry is { id: string; title: string; responses: number } => Boolean(entry))}
                statsByEvent={statsByEvent}
              />
            </div>
            {recurringWeak.length > 0 ? (
              <div className="mt-3 rounded-xl border border-[#e5cf93] bg-[#fffaf0] px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#7a5a17]">
                  Recurring weak categories across events
                </p>
                <ul className="mt-1 list-disc pl-5 text-xs text-[#6a5a2a]">
                  {recurringWeak.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
