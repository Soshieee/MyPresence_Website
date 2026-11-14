"use client";

// Simplified "Events" analytics module (P8).
// One chart for the whole church: year view (monthly points, no details) and
// month view (day-level points with click-to-open details, feedback ratings
// for linked events, and the First/Second Sunday Service split). A composition
// strip on the right always shows who attended (network / age / gender /
// newcomers) — it is informational, never a filter.

import { useEffect, useMemo, useState } from "react";
import { DonutStatPanel } from "@/components/attendance-charts";
import { AGE_BUCKETS, GENDER_COLORS } from "@/components/analytics/demographics";
import { EventsTimelineChart, type EventChartEventMarker, type EventChartPoint } from "@/components/analytics/events-timeline-chart";
import { FEEDBACK_CATEGORIES, type EventFeedbackSummary } from "@/components/event-feedback";
import { GROUP_COLORS } from "@/lib/analytics-colors";
import { normalizeAttendanceType, type AttendanceType } from "@/lib/attendance";
import {
  fetchAnalyticsEvents,
  fetchAnalyticsUsers,
  fetchAttendanceHistory,
  fetchFeedbackSummaries,
  formatDayLabel,
  formatMonthKey,
  type AnalyticsEvent,
  type AnalyticsUser
} from "@/lib/analytics-data";
import { getNetworkFromProfile, NETWORK_LABELS, type NetworkKey } from "@/lib/networks";
import { hasSupabaseEnv } from "@/lib/supabase";
import type { AttendanceLog } from "@/types";

type TypeFilter = "all" | "sunday" | "special";

// Special events are everything except Sunday Service, Prayer Meeting and the
// Men's/Women's Network gatherings (per the stakeholder's definition).
const SPECIAL_EXCLUDED: AttendanceType[] = ["Sunday Service", "Prayer Meeting", "Men's Network", "Women's Network"];

function matchesTypeFilter(log: AttendanceLog, filter: TypeFilter): boolean {
  if (filter === "all") return true;
  const type = normalizeAttendanceType(log.attendance_context, log.attendance_group);
  if (!type) return false;
  if (filter === "sunday") return type === "Sunday Service";
  return !SPECIAL_EXCLUDED.includes(type);
}

function matchesEventFilter(eventType: string | null, filter: TypeFilter): boolean {
  if (filter === "all") return true;
  if (filter === "sunday") return eventType === "Sunday Service";
  return eventType === "Rooftop" || eventType === "General";
}

const NETWORK_ORDER: NetworkKey[] = ["kidsMinistry", "youthMinistry", "youngProfessionals", "mensNetwork", "womensNetwork"];

function monthKeyLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  if (!year || !month) return key;
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "short" });
}

function feedbackCategoryValue(summary: EventFeedbackSummary | undefined, key: string): number | null {
  if (!summary) return null;
  const record = summary as unknown as Record<string, unknown>;
  const averageKey = `avg_${key}`;
  const value = record[averageKey];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function feedbackCategoryResponses(summary: EventFeedbackSummary | undefined, key: string): number {
  if (!summary) return 0;
  const record = summary as unknown as Record<string, unknown>;
  const value = record[key.replace("_rating", "_responses")];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function shouldShowSundayAnalytics(
  typeFilter: TypeFilter,
  events: Array<Pick<AnalyticsEvent, "event_type">>
): boolean {
  return typeFilter === "sunday" && events.every((event) => event.event_type === "Sunday Service");
}

export function EventsAnalyticsModule() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorText, setErrorText] = useState("");
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [users, setUsers] = useState<AnalyticsUser[]>([]);
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);
  const [feedback, setFeedback] = useState<Map<string, EventFeedbackSummary>>(new Map());

  const [year, setYear] = useState("");
  const [month, setMonth] = useState("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [comparePrevYear, setComparePrevYear] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (!hasSupabaseEnv) {
        if (active) {
          setStatus("error");
          setErrorText("Supabase is not configured. Set the NEXT_PUBLIC environment variables first.");
        }
        return;
      }

      try {
        const [history, directory, eventRows, feedbackMap] = await Promise.all([
          fetchAttendanceHistory(),
          fetchAnalyticsUsers(),
          fetchAnalyticsEvents(),
          fetchFeedbackSummaries()
        ]);
        if (!active) return;
        setLogs(history);
        setUsers(directory);
        setEvents(eventRows);
        setFeedback(feedbackMap);
        setStatus("ready");
      } catch (err: unknown) {
        if (!active) return;
        console.error(err);
        setErrorText(err instanceof Error ? err.message : "Unknown error");
        setStatus("error");
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  const yearOptions = useMemo(() => {
    const years = new Set<string>();
    for (const log of logs) years.add(log.attended_date.slice(0, 4));
    return Array.from(years).sort().reverse();
  }, [logs]);

  // Derived selection: fall back to the latest year with data until the user picks one.
  const effectiveYear = useMemo(
    () => (year && yearOptions.includes(year) ? year : yearOptions[0] ?? ""),
    [year, yearOptions]
  );

  const monthOptions = useMemo(() => {
    if (!effectiveYear) return [] as string[];
    const months = new Set<string>();
    for (const log of logs) {
      if (log.attended_date.slice(0, 4) !== effectiveYear) continue;
      months.add(log.attended_date.slice(5, 7));
    }
    for (const event of events) {
      if (event.event_date?.slice(0, 4) === effectiveYear) months.add(event.event_date.slice(5, 7));
    }
    return Array.from(months).sort();
  }, [logs, events, effectiveYear]);

  const userByStudentId = useMemo(() => {
    const map = new Map<string, AnalyticsUser>();
    for (const user of users) map.set(user.student_id, user);
    return map;
  }, [users]);

  const filteredLogs = useMemo(() => logs.filter((log) => matchesTypeFilter(log, typeFilter)), [logs, typeFilter]);

  const hasPrevYearData = useMemo(() => {
    if (!effectiveYear) return false;
    const prev = String(Number(effectiveYear) - 1);
    return filteredLogs.some((log) => log.attended_date.startsWith(prev));
  }, [filteredLogs, effectiveYear]);

  const chartBuild = useMemo(() => {
    const empty = { points: [] as EventChartPoint[], granularity: "year" as const };
    if (status !== "ready" || !effectiveYear) return empty;

    const eventMarkersByKey = (keyPrefix: string): EventChartEventMarker[] =>
      events
        .filter(
          (event) =>
            event.event_date?.startsWith(keyPrefix) && matchesEventFilter(event.event_type, typeFilter)
        )
        .map((event) => ({ id: event.id, title: event.title, eventType: event.event_type }));

    const attendeesInRange = (prefix: string) => {
      const set = new Set<string>();
      for (const log of filteredLogs) {
        if (log.attended_date.startsWith(prefix)) set.add(log.student_id);
      }
      return set;
    };

    if (month === "all") {
      const prevYear = String(Number(effectiveYear) - 1);
      const points: EventChartPoint[] = Array.from({ length: 12 }, (_, index) => {
        const monthNumber = `${index + 1}`.padStart(2, "0");
        const key = `${effectiveYear}-${monthNumber}`;
        const prevKey = `${prevYear}-${monthNumber}`;
        const prevSet = attendeesInRange(prevKey);
        return {
          key,
          label: monthKeyLabel(key),
          fullLabel: formatMonthKey(key),
          value: attendeesInRange(key).size,
          prevValue: prevSet.size > 0 ? prevSet.size : null,
          events: eventMarkersByKey(key),
          clickHint: "Click to view this month",
          selected: false
        };
      });
      return { points, granularity: "year" as const };
    }

    const monthPrefix = `${effectiveYear}-${month}`;
    const prevYearPrefix = `${Number(effectiveYear) - 1}-${month}`;
    const days = new Set<string>();
    for (const log of filteredLogs) {
      if (log.attended_date.startsWith(monthPrefix)) days.add(log.attended_date);
    }
    for (const event of events) {
      if (event.event_date?.startsWith(monthPrefix)) days.add(event.event_date);
    }

    const points: EventChartPoint[] = Array.from(days)
      .sort()
      .map((date) => {
        const day = date.slice(8, 10);
        const prevDate = `${prevYearPrefix}-${day}`;
        const set = attendeesInRange(date);
        const prevSet = attendeesInRange(prevDate);
        return {
          key: date,
          label: String(Number(day)),
          fullLabel: formatDayLabel(date),
          value: set.size,
          prevValue: prevSet.size > 0 ? prevSet.size : null,
          events: eventMarkersByKey(date),
          clickHint: "Click for details",
          selected: selectedDate === date
        };
      });

    return { points, granularity: "month" as const };
  }, [events, filteredLogs, month, selectedDate, status, typeFilter, effectiveYear]);

  const focusedLogs = useMemo(() => {
    if (selectedDate) return filteredLogs.filter((log) => log.attended_date === selectedDate);
    if (month !== "all" && effectiveYear) {
      return filteredLogs.filter((log) => log.attended_date.startsWith(`${effectiveYear}-${month}`));
    }
    if (effectiveYear) return filteredLogs.filter((log) => log.attended_date.startsWith(effectiveYear));
    return filteredLogs;
  }, [filteredLogs, month, selectedDate, effectiveYear]);

  const composition = useMemo(() => {
    const attendees = new Set<string>();
    const newcomers = new Set<string>();
    for (const log of focusedLogs) {
      attendees.add(log.student_id);
      if (log.was_newcomer) newcomers.add(log.student_id);
    }

    const networkCounts = new Map<NetworkKey, number>();
    const ageCounts = new Map<string, number>();
    const genderCounts = new Map<string, number>();
    let unknownProfile = 0;

    for (const studentId of attendees) {
      const user = userByStudentId.get(studentId);
      if (!user) {
        unknownProfile += 1;
        continue;
      }
      const network = getNetworkFromProfile(user.age, user.gender);
      if (network) networkCounts.set(network, (networkCounts.get(network) ?? 0) + 1);

      const age = user.age;
      if (age === null || !Number.isFinite(age)) {
        ageCounts.set("unknown", (ageCounts.get("unknown") ?? 0) + 1);
      } else {
        const bucket = AGE_BUCKETS.find((entry) => age <= entry.max) ?? AGE_BUCKETS[AGE_BUCKETS.length - 1];
        ageCounts.set(bucket.key, (ageCounts.get(bucket.key) ?? 0) + 1);
      }

      const gender = user.gender ?? "Unknown";
      genderCounts.set(gender, (genderCounts.get(gender) ?? 0) + 1);
    }

    const networkItems: Array<{ label: string; value: number; color: string }> = NETWORK_ORDER.map((key) => ({
      label: NETWORK_LABELS[key],
      value: networkCounts.get(key) ?? 0,
      color: GROUP_COLORS[key]
    }));
    if (unknownProfile > 0) networkItems.push({ label: "Unknown", value: unknownProfile, color: "#94a3b8" });

    const ageItems: Array<{ label: string; value: number; color: string }> = AGE_BUCKETS.map((bucket) => ({
      label: bucket.label as string,
      value: ageCounts.get(bucket.key) ?? 0,
      color: bucket.color as string
    }));
    if ((ageCounts.get("unknown") ?? 0) > 0) {
      ageItems.push({ label: "Unknown", value: ageCounts.get("unknown") ?? 0, color: "#94a3b8" });
    }

    const genderItems = Array.from(genderCounts.entries()).map(([label, value]) => ({
      label,
      value,
      color: GENDER_COLORS[label] ?? "#94a3b8"
    }));

    const returning = attendees.size - newcomers.size;
    const newcomerItems = [
      { label: "Newcomers", value: newcomers.size, color: "#f59e0b" },
      { label: "Existing members", value: returning, color: "#10b981" }
    ];

    return { attendees: attendees.size, networkItems, ageItems, genderItems, newcomerItems };
  }, [focusedLogs, userByStudentId]);

  const details = useMemo(() => {
    if (!selectedDate) return null;
    const dayLogs = filteredLogs.filter((log) => log.attended_date === selectedDate);
    const attendees = new Set(dayLogs.map((log) => log.student_id));

    const contextBreakdown = new Map<string, { checkIns: number; people: Set<string> }>();
    for (const log of dayLogs) {
      const context = normalizeAttendanceType(log.attendance_context, log.attendance_group) ?? "Unknown";
      let entry = contextBreakdown.get(context);
      if (!entry) {
        entry = { checkIns: 0, people: new Set<string>() };
        contextBreakdown.set(context, entry);
      }
      entry.checkIns += 1;
      entry.people.add(log.student_id);
    }

    const sundayLogs = dayLogs.filter(
      (log) => normalizeAttendanceType(log.attendance_context, log.attendance_group) === "Sunday Service"
    );
    const isSundaySession = (log: AttendanceLog, session: string) =>
      log.service_type === session || log.attendance_group === session;
    const sundayPeople = new Set(sundayLogs.map((log) => log.student_id));
    const firstService = new Set(
      sundayLogs.filter((log) => isSundaySession(log, "First Service")).map((log) => log.student_id)
    ).size;
    const secondService = new Set(
      sundayLogs.filter((log) => isSundaySession(log, "Second Service")).map((log) => log.student_id)
    ).size;

    const dayEvents = events.filter(
      (event) => event.event_date === selectedDate && matchesEventFilter(event.event_type, typeFilter)
    );

    return {
      date: selectedDate,
      attendees: attendees.size,
      checkIns: dayLogs.length,
      contexts: Array.from(contextBreakdown.entries()).map(([label, entry]) => ({
        label,
        checkIns: entry.checkIns,
        people: entry.people.size
      })),
      sunday:
        sundayLogs.length > 0 && shouldShowSundayAnalytics(typeFilter, dayEvents)
          ? { overall: sundayPeople.size, firstService, secondService }
          : null,
      events: dayEvents
    };
  }, [events, filteredLogs, selectedDate, typeFilter]);

  if (status === "loading") {
    return (
      <section className="analytics-panel">
        <h2 className="font-[var(--font-heading)] text-lg text-[#23332d]">Events</h2>
        <p className="mt-3 status-info">Loading attendance history...</p>
      </section>
    );
  }

  if (status === "error") {
    return (
      <section className="analytics-panel">
        <h2 className="font-[var(--font-heading)] text-lg text-[#23332d]">Events</h2>
        <p className="mt-3 status-error">The attendance history could not be loaded. {errorText}</p>
      </section>
    );
  }

  const selectedMonthLabel = month === "all" ? "" : formatMonthKey(`${effectiveYear}-${month}`);

  return (
    <div className="space-y-4">
      <section className="card flex flex-wrap items-center gap-3">
        <div>
          <label className="field-label" htmlFor="events-year">Year</label>
          <select
            id="events-year"
            className="field-input max-w-[140px]"
            value={effectiveYear}
            onChange={(event) => {
              setYear(event.target.value);
              setMonth("all");
              setSelectedDate(null);
            }}
          >
            {yearOptions.length === 0 ? <option value="">No years with data</option> : null}
            {yearOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="field-label" htmlFor="events-month">Month</label>
          <select
            id="events-month"
            className="field-input max-w-[200px]"
            value={month}
            onChange={(event) => {
              setMonth(event.target.value);
              setSelectedDate(null);
            }}
          >
            <option value="all">Whole year (monthly view)</option>
            {monthOptions.map((option) => (
              <option key={option} value={option}>{formatMonthKey(`${effectiveYear}-${option}`)}</option>
            ))}
          </select>
        </div>

        <div>
          <p className="field-label">Show</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => { setTypeFilter("all"); setSelectedDate(null); }}
              className={typeFilter === "all" ? "btn-primary px-3 py-1.5 text-xs" : "btn-ghost px-3 py-1.5 text-xs"}
            >
              All activities
            </button>
            <button
              type="button"
              onClick={() => { setTypeFilter("sunday"); setSelectedDate(null); }}
              className={typeFilter === "sunday" ? "btn-primary px-3 py-1.5 text-xs" : "btn-ghost px-3 py-1.5 text-xs"}
            >
              Sunday service only
            </button>
            <button
              type="button"
              onClick={() => { setTypeFilter("special"); setSelectedDate(null); }}
              className={typeFilter === "special" ? "btn-primary px-3 py-1.5 text-xs" : "btn-ghost px-3 py-1.5 text-xs"}
            >
              Special events only
            </button>
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs font-semibold text-[#35564a]">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[#385b4f]"
            checked={comparePrevYear}
            onChange={(event) => setComparePrevYear(event.target.checked)}
          />
          Compare with last year
        </label>
      </section>

      <EventsTimelineChart
        title={
          month === "all"
            ? `Church attendance — ${effectiveYear}`
            : `Church attendance — ${selectedMonthLabel}`
        }
        note={month === "all" ? "Whole-year view: spot the peak months. Pick a month for day-level details." : undefined}
        granularity={chartBuild.granularity}
        points={chartBuild.points}
        showPrevYear={comparePrevYear}
        hasPrevYearData={hasPrevYearData}
        onSelectPoint={(point) => {
          if (chartBuild.granularity === "year") {
            setMonth(point.key.slice(5, 7));
            setSelectedDate(null);
          } else {
            setSelectedDate((previous) => (previous === point.key ? null : point.key));
          }
        }}
      />

      {details ? (
        <section className="rounded-2xl border border-[#9dbfb1] bg-[#eef4f1] p-4" id="events-day-details">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-[var(--font-heading)] text-lg text-[#25493e]">
              {new Date(`${details.date}T00:00:00`).toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric"
              })}
            </h3>
            <p className="text-xs font-semibold text-[#35564a]">
              {details.attendees} attendees • {details.checkIns} check-ins
            </p>
          </div>

          {details.sunday ? (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">
                Sunday Service — First vs Second
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl bg-white/80 px-3 py-2">
                  <p className="text-[11px] font-semibold text-[#527064]">Overall</p>
                  <p className="font-[var(--font-heading)] text-xl text-[#22322d]">{details.sunday.overall}</p>
                </div>
                <div className="rounded-xl bg-white/80 px-3 py-2">
                  <p className="text-[11px] font-semibold text-[#527064]">First Service</p>
                  <p className="font-[var(--font-heading)] text-xl text-[#22322d]">{details.sunday.firstService}</p>
                  <div className="mt-1 h-2 rounded-full bg-[#d5dfdb]">
                    <div
                      className="h-2 rounded-full bg-[#2563eb]"
                      style={{
                        width: `${
                          details.sunday.overall > 0
                            ? (details.sunday.firstService / details.sunday.overall) * 100
                            : 0
                        }%`
                      }}
                    />
                  </div>
                </div>
                <div className="rounded-xl bg-white/80 px-3 py-2">
                  <p className="text-[11px] font-semibold text-[#527064]">Second Service</p>
                  <p className="font-[var(--font-heading)] text-xl text-[#22322d]">{details.sunday.secondService}</p>
                  <div className="mt-1 h-2 rounded-full bg-[#d5dfdb]">
                    <div
                      className="h-2 rounded-full bg-[#0ea5e9]"
                      style={{
                        width: `${
                          details.sunday.overall > 0
                            ? (details.sunday.secondService / details.sunday.overall) * 100
                            : 0
                        }%`
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {details.contexts.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Attendance by type</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {details.contexts.map((context) => (
                  <div key={context.label} className="rounded-xl bg-white/80 px-3 py-2 text-sm">
                    <span className="font-semibold text-[#315349]">{context.label}</span>
                    <span className="ml-2 text-[#4f675e]">
                      {context.people} people • {context.checkIns} check-ins
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {details.events.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Events on this day</p>
              <div className="mt-2 grid gap-2">
                {details.events.map((event) => {
                  const summary = feedback.get(event.id);
                  return (
                    <div key={event.id} className="rounded-xl bg-white/85 px-3 py-2">
                      <p className="font-semibold text-[#315349]">
                        {event.title}
                        {event.event_type ? ` • ${event.event_type}` : ""}
                      </p>
                      {event.location ? (
                        <p className="mt-0.5 text-[11px] text-[#5d736a]">Location: {event.location}</p>
                      ) : null}
                      {event.details ? (
                        <p className="mt-1 text-xs leading-relaxed text-[#4f675e]">{event.details}</p>
                      ) : null}

                      {summary && (summary.total_responses ?? 0) > 0 ? (
                        <div className="mt-2 rounded-xl border border-[#e2e8e5] bg-white px-3 py-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#527064]">
                              Event feedback
                            </p>
                            <p className="text-xs text-[#4f675e]">
                              {summary.total_responses} {summary.total_responses === 1 ? "response" : "responses"}
                              {typeof summary.avg_overall_rating === "number" ? (
                                <span className="ml-2 font-semibold text-[#8a5a17]">
                                  ★ {summary.avg_overall_rating.toFixed(1)}
                                </span>
                              ) : null}
                            </p>
                          </div>
                          <div className="mt-2 grid gap-1.5">
                            {FEEDBACK_CATEGORIES.map((category) => {
                              const value = feedbackCategoryValue(summary, category.key);
                              const responses = feedbackCategoryResponses(summary, category.key);
                              const hasRating = responses > 0 && value !== null;
                              return (
                                <div key={category.key} className="grid gap-1 text-[11px]">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-semibold text-[#496359]">{category.label}</span>
                                    <span className="text-[#315349]">
                                      {hasRating ? value.toFixed(1) : "0.0"} / 5 • {responses}{" "}
                                      {responses === 1 ? "response" : "responses"}
                                    </span>
                                  </div>
                                  <div className="h-2 overflow-hidden rounded-full bg-[#e8f0ec]">
                                    <div
                                      className="h-full rounded-full bg-[#d9a441]"
                                      style={{ width: `${hasRating ? Math.min(Math.max(value, 0) / 5, 1) * 100 : 0}%` }}
                                    />
                                  </div>
                                  {responses === 0 ? <span className="text-[#7c918a]">No data yet</span> : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <p className="mt-1 text-[11px] text-[#7c918a]">No feedback recorded for this event yet.</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {details.checkIns === 0 && details.events.length > 0 ? (
            <p className="mt-3 text-sm text-[#5d736a]">This event day has no recorded attendance yet.</p>
          ) : null}
        </section>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <DonutStatPanel
          title="Network"
          items={composition.networkItems}
          emptyText="No attendee profiles in this period."
          centerLabel="attendees"
        />
        <DonutStatPanel
          title="Age"
          items={composition.ageItems}
          emptyText="No age data available."
          centerLabel="attendees"
        />
        <DonutStatPanel
          title="Gender"
          items={composition.genderItems}
          emptyText="No gender data available."
          centerLabel="attendees"
        />
        <DonutStatPanel
          title="Newcomers"
          items={composition.newcomerItems}
          emptyText="No attendees in this period."
          centerLabel="attendees"
        />
      </div>
      <p className="text-[11px] text-[#7c918a]">
        The pies describe the {selectedDate ? "selected day's" : month === "all" ? "selected year's" : "selected month's"} attendees
        {composition.attendees > 0 ? ` (${composition.attendees} unique people)` : ""}. They are informational, not filters.
      </p>
    </div>
  );
}
