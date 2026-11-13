"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import CalendarImage from "@/components/calendar-image";
import { hasSupabaseEnv, supabase, supabaseEnvIssue } from "@/lib/supabase";
import { AttendanceLog, CalendarImageRow, EventItem, UserFace } from "@/types";
import { EventsAnalyticsModule } from "@/components/analytics/events-module";
import { LifegroupAnalyticsModule } from "@/components/analytics/lifegroup-module";
import { MembersAnalyticsModule } from "@/components/analytics/members-module";
import { buildStudentNetworkMap, createEmptyNetworkCounts } from "@/lib/networks";
import { isMissingEventTypeColumnError } from "@/lib/attendance";
import { toLocalDateInput } from "@/lib/date";
import {
  INSIGHT_ATTENDANCE_DROP_PCT,
  INSIGHT_LOW_RATING,
  INSIGHT_MEMBER_BASELINE_DAYS,
  INSIGHT_MEMBER_BASELINE_MIN,
  INSIGHT_MEMBER_INACTIVE_DAYS,
  INSIGHT_MIN_CHECKINS_PER_WINDOW,
  INSIGHT_MIN_RESPONSES,
  attendanceDropInsights,
  dataQualityInsights,
  lowRatingInsights,
  memberDeclineInsights,
  recurringWeakSummaryInsights,
  type Insight,
  type InsightAttendanceRow
} from "@/lib/insights";
import type { EventFeedbackSummary } from "@/components/event-feedback";
import { MIN_ANALYTICS_DATE } from "@/lib/analytics-data";

type AnalyticsView = "events" | "lifegroup" | "members";
const DEFAULT_EVENT_POSTER = "/default event poster.jpg";
const EVENTS_PER_PAGE = 3;

function isMissingUserColumnError(message: string) {
  return /column\s+users\.(age|gender|newcomer)\s+does not exist/i.test(message);
}

function isMissingAttendanceColumnError(message: string) {
  return /column\s+attendance\.was_newcomer\s+does not exist/i.test(message);
}

function isMissingClassificationColumnError(message: string) {
  return /column\s+attendance\.(attendance_context|attendance_group)\s+does not exist/i.test(message);
}

function isMissingEventsTableError(message: string) {
  return /Could not find the table 'public\.events'|relation\s+"?events"?\s+does not exist/i.test(message);
}

function isMissingColumnError(message: string) {
  return /column .* does not exist|Could not find the '.*' column|schema cache/i.test(message);
}

export default function HomePage() {
  const [users, setUsers] = useState<UserFace[]>([]);
  const [attendance, setAttendance] = useState<AttendanceLog[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [calendarImage, setCalendarImage] = useState<CalendarImageRow | null>(null);
  const [status, setStatus] = useState("Loading dashboard analytics...");
  const [analyticsView, setAnalyticsView] = useState<AnalyticsView>("events");
  const [eventPage, setEventPage] = useState(0);
  // P7 — automated insights (admin-gated)
  const [isAdmin, setIsAdmin] = useState(false);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [insightsStatus, setInsightsStatus] = useState<"loading" | "ready">("loading");
  const [insightsNotice, setInsightsNotice] = useState("");
  const insightsLoadedRef = useRef(false);

  // The full insights content lives in a modal; the section above renders only
  // a compact summary bar whose "View insights" button opens it.
  const [insightsOpen, setInsightsOpen] = useState(false);
  const insightsTriggerRef = useRef<HTMLButtonElement | null>(null);

  const openInsights = useCallback(() => setInsightsOpen(true), []);
  const closeInsights = useCallback(() => {
    setInsightsOpen(false);
    // Hand focus back to the "View insights" button so keyboard users resume
    // exactly where the modal took it from.
    insightsTriggerRef.current?.focus();
  }, []);

  // Stable callback ref so the dialog is focused once when it mounts.
  const focusModalDialog = useCallback((node: HTMLDivElement | null) => {
    if (node) node.focus();
  }, []);

  // While the modal is open: Escape closes it and the page behind stops scrolling.
  useEffect(() => {
    if (!insightsOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeInsights();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeInsights, insightsOpen]);

  const range = useMemo(() => {
    const today = new Date();

    const day = toLocalDateInput(today);
    return { from: day < MIN_ANALYTICS_DATE ? MIN_ANALYTICS_DATE : day, to: day };
  }, []);

  const eventTitleById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const event of events) {
      map[event.id] = event.title;
    }
    return map;
  }, [events]);

  useEffect(() => {
    if (!hasSupabaseEnv) return;
    let active = true;
    void supabase.rpc("is_admin").then(({ data, error }) => {
      if (active) setIsAdmin(!error && data === true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isAdmin || insightsLoadedRef.current) return;
    insightsLoadedRef.current = true;

    const load = async () => {
      const todayIso = toLocalDateInput(new Date());
      const fromIso = toLocalDateInput(new Date(new Date(`${todayIso}T00:00:00`).getTime() - 89 * 86_400_000));

      const [attendanceResult, summaryResult] = await Promise.all([
        supabase
          .from("attendance")
          .select("student_id, attendance_context, attendance_group, attended_date")
          .gte("attended_date", fromIso),
        supabase
          .from("event_feedback_summary")
          .select(
            "event_id, total_responses, avg_overall_rating, avg_food_rating, avg_venue_rating, avg_music_rating, avg_program_rating, avg_staff_rating, avg_speaker_rating"
          )
      ]);

      const rows = (attendanceResult.data ?? []) as InsightAttendanceRow[];
      const summaries = (summaryResult.data ?? []) as EventFeedbackSummary[];

      const collected = [
        ...attendanceDropInsights(rows, todayIso),
        ...memberDeclineInsights(rows, todayIso),
        ...dataQualityInsights(rows),
        ...lowRatingInsights(summaries, eventTitleById),
        ...recurringWeakSummaryInsights(summaries, eventTitleById)
      ].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "review" ? -1 : 1));

      setInsights(collected);
      const notice = [attendanceResult.error?.message, summaryResult.error?.message]
        .filter(Boolean)
        .join(" ");
      setInsightsNotice(notice);
      setInsightsStatus("ready");
    };

    void load();
  }, [isAdmin, eventTitleById]);

  useEffect(() => {
    const loadData = async () => {
      if (!hasSupabaseEnv) {
        setStatus(supabaseEnvIssue ?? "Missing Supabase environment values.");
        return;
      }

      const warnings: string[] = [];

      let userRows: UserFace[] = [];
      // descriptor (face embedding) is intentionally not selected here —
      // only the scanner and enrollment flows may load biometric data.
      const userResult = await supabase.from("users").select("id, student_id, full_name, age, gender, newcomer, created_at");
      if (userResult.error) {
        if (isMissingUserColumnError(userResult.error.message)) {
          const fallback = await supabase.from("users").select("id, student_id, full_name, created_at");
          if (fallback.error) {
            setStatus(`Failed to load dashboard: ${fallback.error.message}`);
            return;
          }

          userRows = ((fallback.data ?? []) as Array<Omit<UserFace, "age" | "gender" | "newcomer">>).map((row) => ({
            ...row,
            age: null,
            gender: null,
            newcomer: false
          }));
          warnings.push("Users schema is outdated. Run supabase/schema.sql to add age, gender, and newcomer.");
        } else {
          setStatus(`Failed to load dashboard: ${userResult.error.message}`);
          return;
        }
      } else {
        userRows = (userResult.data ?? []) as UserFace[];
      }

      let attendanceRows: AttendanceLog[] = [];
      const attendanceResult = await supabase
        .from("attendance")
        .select("id, student_id, full_name, was_newcomer, attendance_context, attendance_group, event_id, attended_date, attended_at")
        .gte("attended_date", range.from)
        .lte("attended_date", range.to);

      if (attendanceResult.error) {
        if (
          isMissingAttendanceColumnError(attendanceResult.error.message) ||
          isMissingClassificationColumnError(attendanceResult.error.message)
        ) {
          const fallback = await supabase
            .from("attendance")
            .select("id, student_id, full_name, event_id, attended_date, attended_at")
            .gte("attended_date", range.from)
            .lte("attended_date", range.to);

          if (fallback.error) {
            setStatus(`Failed to load dashboard: ${fallback.error.message}`);
            return;
          }

          attendanceRows = ((fallback.data ?? []) as Array<Omit<AttendanceLog, "was_newcomer" | "attendance_context" | "attendance_group">>).map((row) => ({
            ...row,
            was_newcomer: false,
            attendance_context: null,
              attendance_group: null,
              event_id: null
          }));
          warnings.push("Attendance schema is outdated. Run supabase/schema.sql to add was_newcomer, attendance_context, and attendance_group.");
        } else {
          setStatus(`Failed to load dashboard: ${attendanceResult.error.message}`);
          return;
        }
      } else {
        attendanceRows = (attendanceResult.data ?? []) as AttendanceLog[];
      }

      let eventRows: EventItem[] = [];
      const eventsResult = await supabase
        .from("events")
        .select("id, title, event_date, location, poster_url, event_type, created_at")
        .order("event_date", { ascending: true })
        .limit(100);

      if (eventsResult.error) {
        if (isMissingEventsTableError(eventsResult.error.message)) {
          warnings.push("Events table is missing. Run supabase/schema.sql to enable event manager and home event cards.");
        } else if (isMissingEventTypeColumnError(eventsResult.error.message)) {
          const eventsFallback = await supabase
            .from("events")
            .select("id, title, event_date, location, poster_url, created_at")
            .order("event_date", { ascending: true })
            .limit(100);

          if (eventsFallback.error) {
            warnings.push(`Events could not be loaded: ${eventsFallback.error.message}`);
          } else {
            eventRows = ((eventsFallback.data ?? []) as Array<Omit<EventItem, "event_type">>).map((row) => ({
              ...row,
              event_type: null
            }));
          }
        } else {
          setStatus(`Failed to load dashboard: ${eventsResult.error.message}`);
          return;
        }
      } else {
        eventRows = (eventsResult.data ?? []) as EventItem[];
      }

      let calendarRow: CalendarImageRow | null = null;
      const calendarResult = await supabase
        .from("calendar")
        .select("id, calendar_img_url, storage_path, created_at, updated_at")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (calendarResult.error) {
        if (isMissingColumnError(calendarResult.error.message)) {
          const fallback = await supabase
            .from("calendar")
            .select("created_at")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!fallback.error && fallback.data) {
            calendarRow = {
              id: "",
              calendar_img_url: null,
              storage_path: null,
              created_at: fallback.data.created_at,
              updated_at: null
            };
          }

          warnings.push("Calendar image storage is not enabled yet. Run supabase/patch_2026_10_22_polls_calendar.sql.");
        } else {
          warnings.push(`Calendar image could not be loaded: ${calendarResult.error.message}`);
        }
      } else {
        calendarRow = (calendarResult.data ?? null) as CalendarImageRow | null;
      }

      setUsers(userRows);
      setAttendance(attendanceRows);
      setEvents(eventRows);
      setCalendarImage(calendarRow);
      setStatus(warnings.length > 0 ? warnings.join(" ") : `Dashboard is live (${range.from} to ${range.to}).`);
    };

    void loadData();
  }, [range.from, range.to]);

  const userNetworkMap = useMemo(() => buildStudentNetworkMap(users), [users]);

  const analytics = useMemo(() => {
    const newcomerCount = users.filter((user) => user.newcomer).length;
    const newcomersScannedToday = attendance.filter((entry) => entry.was_newcomer).length;
    const byGroup = createEmptyNetworkCounts();
    const newcomerByGroup = createEmptyNetworkCounts();

    for (const scan of attendance) {
      const networkKey = userNetworkMap.get(scan.student_id);
      if (!networkKey) continue;
      byGroup[networkKey] += 1;
      if (scan.was_newcomer) newcomerByGroup[networkKey] += 1;
    }

    return {
      totalMembers: users.length,
      totalScansToday: attendance.length,
      activeNewcomers: newcomerCount,
      newcomersScannedToday,
      byGroup,
      newcomerByGroup
    };
  }, [attendance, userNetworkMap, users]);

  const totalEventPages = Math.ceil(events.length / EVENTS_PER_PAGE);
  const safeEventPage = Math.min(eventPage, Math.max(totalEventPages - 1, 0));
  const visibleEvents = events.slice(safeEventPage * EVENTS_PER_PAGE, (safeEventPage + 1) * EVENTS_PER_PAGE);

  // Summary-bar counts: derived from the same array the modal renders, so the
  // bar and the modal can never disagree.
  const alertCount = insights.filter((insight) => insight.severity === "review").length;
  const noteCount = insights.length - alertCount;
  const topAlert = insights.find((insight) => insight.severity === "review") ?? null;

  return (
    <div className="space-y-8 reveal">
      <section className="card overflow-hidden bg-gradient-to-br from-[#f7fbf9] to-[#ecf3f0]">
        <div className="section-head">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h1 className="page-title font-[var(--font-heading)]">Home Dashboard</h1>
              <span className="max-w-full rounded-full border border-[#b8cdc5] bg-[#edf5f2] px-3 py-1 text-[11px] font-medium leading-snug text-[#37564b]">
                {status}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => document.getElementById("monthly-calendar")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="btn-primary"
            >
              Jump to Calendar
            </button>
            <button
              type="button"
              onClick={() => document.getElementById("upcoming-events")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="btn-ghost"
            >
              Jump to Upcoming Events
            </button>
          </div>
        </div>
      </section>

      {isAdmin ? (
        <section className="analytics-panel" data-tour="automated-insights">
          {/* Compact summary bar — the full insights content lives in the modal. */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex items-center gap-2.5">
              <h2 className="font-[var(--font-heading)] text-lg text-[#21312b]">Automated Insights</h2>
              <span className="rounded-full border border-[#d7b46a] bg-[#fff8e8] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7a5a17]">
                Administrator
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[#4f675e]">
              {alertCount > 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-[#c2703d]" />
                  {alertCount} {alertCount === 1 ? "alert" : "alerts"}
                </span>
              ) : null}
              {noteCount > 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-[#9db1a9]" />
                  {noteCount} {noteCount === 1 ? "note" : "notes"}
                </span>
              ) : null}
              {topAlert ? (
                <span className="max-w-[300px] truncate rounded-full border border-[#e3b894] bg-[#fff8f3] px-2.5 py-1 text-[11px] font-semibold text-[#a15c2b]">
                  {topAlert.title}
                </span>
              ) : null}
            </div>
            <button
              ref={insightsTriggerRef}
              type="button"
              onClick={openInsights}
              className="btn-ghost px-4 py-2 text-xs"
            >
              View insights
            </button>
          </div>

          {insightsStatus === "loading" ? (
            <p className="mt-2 status-info">Evaluating monitoring rules...</p>
          ) : null}
          {insightsNotice ? <p className="mt-2 status-info">Some data was unavailable: {insightsNotice}</p> : null}

          {insights.length === 0 && insightsStatus === "ready" ? (
            <p className="mt-2 text-sm text-[#5d736a]">
              No alerts — all monitored metrics are within their thresholds.
            </p>
          ) : null}

          {insightsOpen ? (
            <div
              className="fixed inset-0 z-[80] flex items-center justify-center bg-[#16241f]/70 px-4 py-6"
              role="dialog"
              aria-modal="true"
              aria-labelledby="insights-modal-title"
              onClick={closeInsights}
            >
              <div
                ref={focusModalDialog}
                tabIndex={-1}
                className="flex max-h-[85vh] w-[92vw] max-w-[720px] flex-col overflow-hidden rounded-3xl border border-[#c3d0cb] bg-[#f8fbfa] shadow-[0_24px_80px_rgba(22,36,31,0.4)] outline-none"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  // Keep keyboard focus cycling inside the dialog while open.
                  if (event.key !== "Tab") return;
                  const focusables = Array.from(
                    event.currentTarget.querySelectorAll<HTMLElement>(
                      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
                    )
                  ).filter((element) => element.offsetParent !== null);
                  if (focusables.length === 0) {
                    event.preventDefault();
                    return;
                  }
                  const first = focusables[0];
                  const last = focusables[focusables.length - 1];
                  if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
                    event.preventDefault();
                    last.focus();
                  } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                  }
                }}
              >
                <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#d6e1dd] bg-gradient-to-br from-[#e9f3ef] to-[#f8fbfa] px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <h2 id="insights-modal-title" className="font-[var(--font-heading)] text-lg text-[#22332d]">
                      Automated Insights
                    </h2>
                    <span className="rounded-full border border-[#d7b46a] bg-[#fff8e8] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7a5a17]">
                      Administrator
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={closeInsights}
                    aria-label="Close insights"
                    title="Close"
                    className="shrink-0 rounded-full border border-[#b9cac3] bg-white/80 px-3 py-1 text-xs font-semibold text-[#35564a] hover:bg-white"
                  >
                    ✕
                  </button>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                  <p className="text-sm text-[#5d7269]">
                    Computed automatically on load from the latest data. Flags are review prompts with stated thresholds
                    — the administrator decides.
                  </p>

                  {insightsStatus === "loading" ? (
                    <p className="mt-3 status-info">Evaluating monitoring rules...</p>
                  ) : null}

                  {insights.length === 0 && insightsStatus === "ready" ? (
                    <p className="mt-3 text-sm text-[#5d736a]">
                      No alerts — all monitored metrics are within their thresholds.
                    </p>
                  ) : null}

                  {insights.length > 0 ? (
                    <div className="mt-3 grid gap-2">
                      {insights.map((insight) => (
                        <div
                          key={insight.id}
                          className={`rounded-xl border-l-4 px-3 py-2 ${
                            insight.severity === "review"
                              ? "border-l-[#c2703d] bg-[#fff8f3]"
                              : "border-l-[#b9cac3] bg-white/80"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-semibold text-[#315349]">{insight.title}</p>
                            {insight.href ? (
                              <Link href={insight.href} className="btn-ghost px-2.5 py-1 text-[11px]">
                                Review
                              </Link>
                            ) : null}
                          </div>
                          <p className="mt-1 text-sm text-[#4f675e]">{insight.detail}</p>
                          <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#8a9a93]">
                            Rule: {insight.window}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <p className="mt-4 text-[11px] leading-5 text-[#8a9a93]">
                    Monitoring rules: weekly attendance drops ≥ {INSIGHT_ATTENDANCE_DROP_PCT}% per group (min{" "}
                    {INSIGHT_MIN_CHECKINS_PER_WINDOW} check-ins in the earlier week) • members inactive{" "}
                    {INSIGHT_MEMBER_INACTIVE_DAYS}+ days after {INSIGHT_MEMBER_BASELINE_MIN}+ attendances in{" "}
                    {INSIGHT_MEMBER_BASELINE_DAYS} days • event ratings ≤ {INSIGHT_LOW_RATING.toFixed(1)}★ with ≥{" "}
                    {INSIGHT_MIN_RESPONSES} responses • recurring weak categories • legacy and weekday data checks.
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="analytics-strip">
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Members</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">{analytics.totalMembers}</p>
        </article>
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Scans Today</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">{analytics.totalScansToday}</p>
        </article>
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Active Newcomers</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">{analytics.activeNewcomers}</p>
        </article>
      </section>

      <section className="flex flex-col space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setAnalyticsView("events")}
            className={analyticsView === "events" ? "btn-primary" : "btn-ghost"}
          >
            Events
          </button>
          <button
            type="button"
            onClick={() => setAnalyticsView("lifegroup")}
            className={analyticsView === "lifegroup" ? "btn-primary" : "btn-ghost"}
          >
            Lifegroup
          </button>
          <button
            type="button"
            onClick={() => setAnalyticsView("members")}
            className={analyticsView === "members" ? "btn-primary" : "btn-ghost"}
          >
            Members
          </button>
        </div>

        {analyticsView === "events" ? <EventsAnalyticsModule /> : null}
        {analyticsView === "lifegroup" ? <LifegroupAnalyticsModule /> : null}
        {analyticsView === "members" ? <MembersAnalyticsModule /> : null}
      </section>

      <section id="monthly-calendar" className="analytics-panel scroll-mt-6">
        <div className="section-head">
          <div>
            <h2 className="font-[var(--font-heading)] text-xl text-[#21312b]">Monthly Calendar</h2>
          </div>
          <Link href="/events-manager" className="btn-ghost px-3 py-1 text-xs">
            Manage Calendar
          </Link>
        </div>
        <div className="mt-4 max-w-4xl">
          <CalendarImage
            src={calendarImage?.calendar_img_url ?? null}
            alt="Monthly calendar"
            emptyMessage="No calendar image has been uploaded yet."
            className="aspect-[4/3] w-full"
          />
        </div>
      </section>

      <section id="upcoming-events" className="analytics-panel scroll-mt-6">
        <div className="section-head">
          <h2 className="font-[var(--font-heading)] text-xl text-[#21312b]">Upcoming Events</h2>
        </div>
        {events.length === 0 ? (
          <p className="mt-4 text-sm text-[#5a7268]">No events yet. Add events in the Event Manager page.</p>
        ) : (
          <>
            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {visibleEvents.map((event) => (
              <article
                key={event.id}
                className="rounded-2xl border border-[#bfd0c9] bg-white/80 p-3 shadow-[0_8px_18px_rgba(56,91,79,0.09)]"
              >
                <div className="relative h-36 w-full overflow-hidden rounded-xl">
                  <Image
                    src={event.poster_url || DEFAULT_EVENT_POSTER}
                    alt={event.poster_url ? event.title : `${event.title} default poster`}
                    fill
                    className="object-cover"
                    sizes="(max-width: 1024px) 100vw, 33vw"
                  />
                </div>
                <h3 className="mt-3 font-[var(--font-heading)] text-lg text-[#263831]">{event.title}</h3>
                <p className="mt-1 text-xs text-[#577067]">
                  {event.event_date ?? "No date"}
                  {event.location ? ` • ${event.location}` : ""}
                </p>
              </article>
            ))}
            </div>
            {totalEventPages > 1 ? (
              <div className="mt-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setEventPage(Math.max(safeEventPage - 1, 0))}
                  className="btn-ghost px-3 py-1 text-xs"
                  disabled={safeEventPage === 0}
                >
                  Previous
                </button>
                <span className="text-xs text-[#5a7268]">
                  Page {safeEventPage + 1} of {totalEventPages}
                </span>
                <button
                  type="button"
                  onClick={() => setEventPage(Math.min(safeEventPage + 1, totalEventPages - 1))}
                  className="btn-ghost px-3 py-1 text-xs"
                  disabled={safeEventPage === totalEventPages - 1}
                >
                  Next
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
