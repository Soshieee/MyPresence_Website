"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { hasSupabaseEnv, supabase, supabaseEnvIssue } from "@/lib/supabase";
import { AttendanceLog, EventItem, UserFace } from "@/types";
import SimpleBarChart from "@/components/simple-bar-chart";
import StackedGroupTimeline from "@/components/stacked-group-timeline";
import StackedPercentageChart from "@/components/stacked-percentage-chart";
import AnalyticsFunnel from "@/components/analytics-funnel";
import { GROUP_COLORS } from "@/lib/analytics-colors";

type RangePreset = "today" | "7d" | "30d" | "custom";
type AnalyticsView = "timeline" | "mix" | "funnel";
const MIN_ANALYTICS_DATE = "2026-01-01";

function isMissingColumnError(message: string) {
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

export default function HomePage() {
  const [users, setUsers] = useState<UserFace[]>([]);
  const [attendance, setAttendance] = useState<AttendanceLog[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [status, setStatus] = useState("Loading dashboard analytics...");
  const [rangePreset, setRangePreset] = useState<RangePreset>("today");
  const [analyticsView, setAnalyticsView] = useState<AnalyticsView>("mix");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const range = useMemo(() => {
    const today = new Date();
    const format = (date: Date) => date.toISOString().slice(0, 10);

    if (rangePreset === "today") {
      const day = format(today);
      return { from: day < MIN_ANALYTICS_DATE ? MIN_ANALYTICS_DATE : day, to: day };
    }

    if (rangePreset === "7d") {
      const from = new Date(today);
      from.setDate(from.getDate() - 6);
      const nextFrom = format(from);
      return { from: nextFrom < MIN_ANALYTICS_DATE ? MIN_ANALYTICS_DATE : nextFrom, to: format(today) };
    }

    if (rangePreset === "30d") {
      const from = new Date(today);
      from.setDate(from.getDate() - 29);
      const nextFrom = format(from);
      return { from: nextFrom < MIN_ANALYTICS_DATE ? MIN_ANALYTICS_DATE : nextFrom, to: format(today) };
    }

    const fallback = format(today);
    const rawFrom = fromDate || fallback;
    const rawTo = toDate || fallback;
    const clampedFrom = rawFrom < MIN_ANALYTICS_DATE ? MIN_ANALYTICS_DATE : rawFrom;
    const clampedTo = rawTo < MIN_ANALYTICS_DATE ? MIN_ANALYTICS_DATE : rawTo;

    return {
      from: clampedFrom,
      to: clampedTo
    };
  }, [fromDate, rangePreset, toDate]);

  useEffect(() => {
    const loadData = async () => {
      if (!hasSupabaseEnv) {
        setStatus(supabaseEnvIssue ?? "Missing Supabase environment values.");
        return;
      }

      const warnings: string[] = [];

      let userRows: UserFace[] = [];
      const userResult = await supabase.from("users").select("id, student_id, full_name, age, gender, newcomer, descriptor, created_at");
      if (userResult.error) {
        if (isMissingColumnError(userResult.error.message)) {
          const fallback = await supabase.from("users").select("id, student_id, full_name, descriptor, created_at");
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
        .select("id, student_id, full_name, was_newcomer, attendance_context, attendance_group, attended_date, attended_at")
        .gte("attended_date", range.from)
        .lte("attended_date", range.to);

      if (attendanceResult.error) {
        if (
          isMissingAttendanceColumnError(attendanceResult.error.message) ||
          isMissingClassificationColumnError(attendanceResult.error.message)
        ) {
          const fallback = await supabase
            .from("attendance")
            .select("id, student_id, full_name, attended_date, attended_at")
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
            attendance_group: null
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
        .select("id, title, details, event_date, location, poster_url, created_at")
        .order("event_date", { ascending: true })
        .limit(6);

      if (eventsResult.error) {
        if (isMissingEventsTableError(eventsResult.error.message)) {
          warnings.push("Events table is missing. Run supabase/schema.sql to enable event manager and home event cards.");
        } else {
          setStatus(`Failed to load dashboard: ${eventsResult.error.message}`);
          return;
        }
      } else {
        eventRows = (eventsResult.data ?? []) as EventItem[];
      }

      setUsers(userRows);
      setAttendance(attendanceRows);
      setEvents(eventRows);
      setStatus(warnings.length > 0 ? warnings.join(" ") : `Dashboard is live (${range.from} to ${range.to}).`);
    };

    void loadData();
  }, [range.from, range.to]);

  const analytics = useMemo(() => {
    const newcomerCount = users.filter((user) => user.newcomer).length;
    const newcomersScannedToday = attendance.filter((entry) => entry.was_newcomer).length;
    const byGroup = {
      firstService: 0,
      secondService: 0,
      rooftop: 0,
      male: 0,
      female: 0
    };
    const newcomerByGroup = {
      firstService: 0,
      secondService: 0,
      rooftop: 0,
      male: 0,
      female: 0
    };

    for (const scan of attendance) {
      if (scan.attendance_context === "Sunday Service") {
        if (scan.attendance_group === "First Service") {
          byGroup.firstService += 1;
          if (scan.was_newcomer) newcomerByGroup.firstService += 1;
        }

        if (scan.attendance_group === "Second Service") {
          byGroup.secondService += 1;
          if (scan.was_newcomer) newcomerByGroup.secondService += 1;
        }
      }

      if (scan.attendance_context === "Events") {
        if (scan.attendance_group === "Rooftop") {
          byGroup.rooftop += 1;
          if (scan.was_newcomer) newcomerByGroup.rooftop += 1;
        }

        if (scan.attendance_group === "Male") {
          byGroup.male += 1;
          if (scan.was_newcomer) newcomerByGroup.male += 1;
        }

        if (scan.attendance_group === "Female") {
          byGroup.female += 1;
          if (scan.was_newcomer) newcomerByGroup.female += 1;
        }
      }
    }

    return {
      totalMembers: users.length,
      totalScansToday: attendance.length,
      activeNewcomers: newcomerCount,
      newcomersScannedToday,
      byGroup,
      newcomerByGroup
    };
  }, [attendance, users]);

  const timelineRows = useMemo(() => {
    const map = new Map<string, { firstService: number; secondService: number; rooftop: number; male: number; female: number }>();

    for (const scan of attendance) {
      if (scan.attended_date < MIN_ANALYTICS_DATE) continue;

      if (!map.has(scan.attended_date)) {
        map.set(scan.attended_date, { firstService: 0, secondService: 0, rooftop: 0, male: 0, female: 0 });
      }

      const row = map.get(scan.attended_date);
      if (!row) continue;

      if (scan.attendance_context === "Sunday Service" && scan.attendance_group === "First Service") row.firstService += 1;
      if (scan.attendance_context === "Sunday Service" && scan.attendance_group === "Second Service") row.secondService += 1;
      if (scan.attendance_context === "Events" && scan.attendance_group === "Rooftop") row.rooftop += 1;
      if (scan.attendance_context === "Events" && scan.attendance_group === "Male") row.male += 1;
      if (scan.attendance_context === "Events" && scan.attendance_group === "Female") row.female += 1;
    }

    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-10)
      .map(([date, row]) => ({
        label: date.slice(5).replace("-", "/"),
        ...row
      }));
  }, [attendance]);

  const funnelSteps = useMemo(() => {
    const studentScanCounts = new Map<string, number>();

    for (const scan of attendance) {
      studentScanCounts.set(scan.student_id, (studentScanCounts.get(scan.student_id) ?? 0) + 1);
    }

    const scanned = studentScanCounts.size;
    const returning = Array.from(studentScanCounts.values()).filter((count) => count >= 2).length;
    const newcomerScanned = attendance.filter((scan) => scan.was_newcomer).length;

    return [
      { label: "Registered", value: users.length, color: "#334155" },
      { label: "Scanned (Range)", value: scanned, color: "#2563eb" },
      { label: "Returning (2+)", value: returning, color: "#10b981" },
      { label: "Newcomer Scans", value: newcomerScanned, color: "#f59e0b" }
    ];
  }, [attendance, users.length]);

  return (
    <div className="space-y-8 reveal">
      <section className="card overflow-hidden bg-gradient-to-br from-[#f7fbf9] to-[#ecf3f0]">
        <div className="section-head">
          <div>
            <h1 className="page-title font-[var(--font-heading)]">Home Dashboard</h1>
            <p className="page-subtitle mt-2">Live analytics and event highlights from Supabase.</p>
          </div>
          <Link href="/events-manager" className="btn-primary">
            Manage Events
          </Link>
        </div>
        <div className="status-info mt-4">{status}</div>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <button type="button" onClick={() => setRangePreset("today")} className={rangePreset === "today" ? "btn-primary" : "btn-ghost"}>Today</button>
          <button type="button" onClick={() => setRangePreset("7d")} className={rangePreset === "7d" ? "btn-primary" : "btn-ghost"}>Last 7 Days</button>
          <button type="button" onClick={() => setRangePreset("30d")} className={rangePreset === "30d" ? "btn-primary" : "btn-ghost"}>Last 30 Days</button>
          <button type="button" onClick={() => setRangePreset("custom")} className={rangePreset === "custom" ? "btn-primary" : "btn-ghost"}>Custom</button>
          {rangePreset === "custom" ? (
            <>
              <input type="date" min={MIN_ANALYTICS_DATE} className="field-input max-w-[170px]" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
              <input type="date" min={MIN_ANALYTICS_DATE} className="field-input max-w-[170px]" value={toDate} onChange={(event) => setToDate(event.target.value)} />
            </>
          ) : null}
        </div>
      </section>

      <section className="analytics-strip">
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Members</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl font-semibold text-[#22322d]">{analytics.totalMembers}</p>
        </article>
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Scans Today</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl font-semibold text-[#22322d]">{analytics.totalScansToday}</p>
        </article>
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Active Newcomers</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl font-semibold text-[#22322d]">{analytics.activeNewcomers}</p>
        </article>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setAnalyticsView("mix")} className={analyticsView === "mix" ? "btn-primary" : "btn-ghost"}>100% Mix</button>
            <button type="button" onClick={() => setAnalyticsView("timeline")} className={analyticsView === "timeline" ? "btn-primary" : "btn-ghost"}>Timeline</button>
            <button type="button" onClick={() => setAnalyticsView("funnel")} className={analyticsView === "funnel" ? "btn-primary" : "btn-ghost"}>Funnel</button>
          </div>

          {analyticsView === "mix" ? (
            <StackedPercentageChart title="Daily Group Mix (100%)" rows={timelineRows} emptyText="No grouped mix data yet." />
          ) : null}

          {analyticsView === "timeline" ? (
            <StackedGroupTimeline title="Daily Group Timeline" rows={timelineRows} emptyText="No grouped attendance timeline yet." />
          ) : null}

          {analyticsView === "funnel" ? (
            <AnalyticsFunnel title="Attendance Funnel" steps={funnelSteps} emptyText="No funnel data yet." />
          ) : null}
        </section>

        <SimpleBarChart
          title="Newcomer Attendance by Service / Event Group"
          items={[
            { label: "1st Service", value: analytics.newcomerByGroup.firstService, color: GROUP_COLORS.firstService },
            { label: "2nd Service", value: analytics.newcomerByGroup.secondService, color: GROUP_COLORS.secondService },
            { label: "Rooftop", value: analytics.newcomerByGroup.rooftop, color: GROUP_COLORS.rooftop },
            { label: "Male", value: analytics.newcomerByGroup.male, color: GROUP_COLORS.male },
            { label: "Female", value: analytics.newcomerByGroup.female, color: GROUP_COLORS.female }
          ]}
          emptyText="No newcomer attendance yet for today."
        />
      </div>

      <section className="analytics-panel">
        <div className="section-head">
          <h2 className="font-[var(--font-heading)] text-xl font-semibold text-[#21312b]">Upcoming Events</h2>
        </div>
        {events.length === 0 ? (
          <p className="mt-4 text-sm text-[#5a7268]">No events yet. Add events in the Event Manager page.</p>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => (
              <article key={event.id} className="rounded-2xl border border-[#bfd0c9] bg-white/80 p-3 shadow-[0_8px_18px_rgba(56,91,79,0.09)]">
                {event.poster_url ? (
                  <img src={event.poster_url} alt={event.title} className="h-36 w-full rounded-xl object-cover" />
                ) : (
                  <div className="flex h-36 w-full items-center justify-center rounded-xl bg-[#dce6e2] text-xs font-semibold text-[#4a665a]">
                    No Poster
                  </div>
                )}
                <h3 className="mt-3 font-[var(--font-heading)] text-lg font-semibold text-[#263831]">{event.title}</h3>
                <p className="mt-1 text-xs text-[#577067]">
                  {event.event_date ?? "No date"}
                  {event.location ? ` • ${event.location}` : ""}
                </p>
                {event.details ? <p className="mt-2 text-sm text-[#3e5850] line-clamp-2">{event.details}</p> : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
