"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { hasSupabaseEnv, supabase, supabaseEnvIssue } from "@/lib/supabase";
import { AttendanceLog, EventItem, UserFace } from "@/types";
import LineChart from "@/components/line-chart";
import { GROUP_COLORS } from "@/lib/analytics-colors";
import { NETWORK_LABELS, buildStudentNetworkMap, createEmptyNetworkCounts } from "@/lib/networks";

type AnalyticsView = "mix" | "eventAttendance" | "funnel";
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
  const [analyticsView, setAnalyticsView] = useState<AnalyticsView>("mix");

  const range = useMemo(() => {
    const today = new Date();
    const format = (date: Date) => date.toISOString().slice(0, 10);

    const day = format(today);
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
        .select("id, title, event_date, location, poster_url, created_at")
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

  const timelineRows = useMemo(() => {
    const map = new Map<string, ReturnType<typeof createEmptyNetworkCounts>>();

    for (const scan of attendance) {
      if (scan.attended_date < MIN_ANALYTICS_DATE) continue;

      if (!map.has(scan.attended_date)) {
        map.set(scan.attended_date, createEmptyNetworkCounts());
      }

      const row = map.get(scan.attended_date);
      if (!row) continue;

      const networkKey = userNetworkMap.get(scan.student_id);
      if (!networkKey) continue;
      row[networkKey] += 1;
    }

    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-10)
      .map(([date, row]) => ({
        label: date.slice(5).replace("-", "/"),
        value: Object.values(row).reduce((total, count) => total + count, 0)
      }));
  }, [attendance, userNetworkMap]);

  const eventAttendanceItems = useMemo(() => {
    const counts: Record<string, number> = {
      "First Service": 0,
      "Second Service": 0,
      "Prayer Meeting": 0,
      Rooftop: 0,
      "Men's Network": 0,
      "Women's Network": 0
    };

    for (const scan of attendance) {
      const normalizedGroup = scan.attendance_group === "Male"
        ? "Men's Network"
        : scan.attendance_group === "Female"
          ? "Women's Network"
          : scan.attendance_group;

      if (!normalizedGroup || !(normalizedGroup in counts)) continue;
      counts[normalizedGroup] += 1;
    }

    return [
      { label: "First Service", value: counts["First Service"], color: "#2563eb" },
      { label: "Second Service", value: counts["Second Service"], color: "#0ea5e9" },
      { label: "Prayer Meeting", value: counts["Prayer Meeting"], color: "#f59e0b" },
      { label: "Rooftop", value: counts.Rooftop, color: "#8b5cf6" },
      { label: "Men's Network", value: counts["Men's Network"], color: "#10b981" },
      { label: "Women's Network", value: counts["Women's Network"], color: "#ef4444" }
    ];
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
            <p className="page-subtitle mt-2">Live analytics and event highlights.</p>
          </div>
          <Link href="/events-manager" className="btn-primary">
            Manage Events
          </Link>
        </div>
        <div className="status-info mt-4">{status}</div>
      </section>

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

      <div className="grid items-stretch gap-6 lg:grid-cols-[1.3fr_1fr]">
        <section className="flex flex-col space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setAnalyticsView("mix")} className={analyticsView === "mix" ? "btn-primary" : "btn-ghost"}>Network Attendance</button>
            <button type="button" onClick={() => setAnalyticsView("eventAttendance")} className={analyticsView === "eventAttendance" ? "btn-primary" : "btn-ghost"}>Event Attendance</button>
            <button type="button" onClick={() => setAnalyticsView("funnel")} className={analyticsView === "funnel" ? "btn-primary" : "btn-ghost"}>Funnel</button>
          </div>

          {analyticsView === "mix" ? (
            <LineChart title="Daily Network Attendance" items={timelineRows} emptyText="No network attendance data yet." />
          ) : null}

          {analyticsView === "eventAttendance" ? (
            <LineChart title="Attendance by Service and Event" items={eventAttendanceItems} emptyText="No event attendance data yet." />
          ) : null}

          {analyticsView === "funnel" ? (
            <LineChart title="Attendance Funnel" items={funnelSteps} emptyText="No funnel data yet." />
          ) : null}

          {analyticsView === "eventAttendance" ? (
            <section className="analytics-panel">
              <h3 className="font-[var(--font-heading)] text-lg text-[#24362f]">Attendance Logs with Date and Event</h3>
              <div className="mt-3 space-y-2">
                {attendance.length === 0 ? (
                  <p className="text-sm text-[#5d736a]">No attendance rows for today.</p>
                ) : (
                  attendance
                    .slice()
                    .sort((a, b) => b.attended_at.localeCompare(a.attended_at))
                    .slice(0, 12)
                    .map((row) => {
                      const normalizedGroup = row.attendance_group === "Male"
                        ? "Men's Network"
                        : row.attendance_group === "Female"
                          ? "Women's Network"
                          : row.attendance_group;

                      return (
                        <div key={row.id} className="rounded-xl border border-[#cbd8d3] bg-white px-3 py-2 text-sm text-[#2f4d43]">
                          <p className="font-semibold">{row.full_name}</p>
                          <p className="text-xs text-[#5e766c]">
                            {row.attended_date} • {new Date(row.attended_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </p>
                          <p className="text-xs text-[#5e766c]">
                            {normalizedGroup ?? "-"} • {row.event_id ? (eventTitleById[row.event_id] ?? "Linked Event") : "No Event"}
                          </p>
                        </div>
                      );
                    })
                )}
              </div>
            </section>
          ) : null}
        </section>

        <div className="flex flex-col space-y-6">
          <LineChart
            title="Newcomer Attendance by Network"
            items={[
              { label: NETWORK_LABELS.kidsMinistry, value: analytics.newcomerByGroup.kidsMinistry, color: GROUP_COLORS.kidsMinistry },
              { label: NETWORK_LABELS.youthMinistry, value: analytics.newcomerByGroup.youthMinistry, color: GROUP_COLORS.youthMinistry },
              { label: NETWORK_LABELS.youngProfessionals, value: analytics.newcomerByGroup.youngProfessionals, color: GROUP_COLORS.youngProfessionals },
              { label: NETWORK_LABELS.mensNetwork, value: analytics.newcomerByGroup.mensNetwork, color: GROUP_COLORS.mensNetwork },
              { label: NETWORK_LABELS.womensNetwork, value: analytics.newcomerByGroup.womensNetwork, color: GROUP_COLORS.womensNetwork }
            ]}
            emptyText="No newcomer scans today."
          />
        </div>
      </div>

      <section className="analytics-panel">
        <div className="section-head">
          <h2 className="font-[var(--font-heading)] text-xl text-[#21312b]">Upcoming Events</h2>
        </div>
        {events.length === 0 ? (
          <p className="mt-4 text-sm text-[#5a7268]">No events yet. Add events in the Event Manager page.</p>
        ) : (
          <>
            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => (
              <article
                key={event.id}
                className="rounded-2xl border border-[#bfd0c9] bg-white/80 p-3 shadow-[0_8px_18px_rgba(56,91,79,0.09)]"
              >
                {event.poster_url ? (
                  <div className="relative h-36 w-full overflow-hidden rounded-xl">
                    <Image src={event.poster_url} alt={event.title} fill className="object-cover" sizes="(max-width: 1024px) 100vw, 33vw" />
                  </div>
                ) : (
                  <div className="flex h-36 w-full items-center justify-center rounded-xl bg-[#dce6e2] text-xs font-semibold text-[#4a665a]">
                    No Poster
                  </div>
                )}
                <h3 className="mt-3 font-[var(--font-heading)] text-lg text-[#263831]">{event.title}</h3>
                <p className="mt-1 text-xs text-[#577067]">
                  {event.event_date ?? "No date"}
                  {event.location ? ` • ${event.location}` : ""}
                </p>
              </article>
            ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
