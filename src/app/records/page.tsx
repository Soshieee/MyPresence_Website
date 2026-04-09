"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { hasSupabaseEnv, supabase, supabaseEnvIssue } from "@/lib/supabase";
import { AttendanceLog, UserFace } from "@/types";
import SimpleBarChart from "@/components/simple-bar-chart";
import StackedGroupTimeline from "@/components/stacked-group-timeline";
import StackedPercentageChart from "@/components/stacked-percentage-chart";
import { GROUP_COLORS } from "@/lib/analytics-colors";
import { NETWORK_LABELS, buildStudentNetworkMap, createEmptyNetworkCounts } from "@/lib/networks";

type RangePreset = "today" | "7d" | "30d" | "custom";
type AnalyticsView = "timeline" | "mix";
const MIN_ANALYTICS_DATE = "2026-01-01";

function isMissingClassificationColumnError(message: string) {
  return /column\s+attendance\.(was_newcomer|attendance_context|attendance_group)\s+does not exist/i.test(message);
}

export default function AttendanceRecordsPage() {
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [users, setUsers] = useState<UserFace[]>([]);
  const [rangePreset, setRangePreset] = useState<RangePreset>("7d");
  const [analyticsView, setAnalyticsView] = useState<AnalyticsView>("mix");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

  const formatDateMMDDYY = useCallback((value: string) => {
    const date = new Date(`${value}T00:00:00`);
    const mm = `${date.getMonth() + 1}`.padStart(2, "0");
    const dd = `${date.getDate()}`.padStart(2, "0");
    const yy = `${date.getFullYear()}`.slice(-2);
    return `${mm}/${dd}/${yy}`;
  }, []);

  const formatTimeHHmm = useCallback((value: string) => {
    const date = new Date(value);
    const hh = `${date.getHours()}`.padStart(2, "0");
    const mm = `${date.getMinutes()}`.padStart(2, "0");
    return `${hh}:${mm}`;
  }, []);

  const fetchLogs = useCallback(async () => {
    if (!hasSupabaseEnv) {
      setError(supabaseEnvIssue ?? "Missing Supabase env values. Update .env.local and restart dev server.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const query = supabase
        .from("attendance")
        .select("id, student_id, full_name, was_newcomer, attendance_context, attendance_group, attended_date, attended_at")
        .gte("attended_date", range.from)
        .lte("attended_date", range.to)
        .order("attended_at", { ascending: false });

      const { data, error: fetchError } = await query;

      const usersResult = await supabase.from("users").select("id, student_id, full_name, age, gender, newcomer, descriptor, created_at");
      if (!usersResult.error) {
        setUsers((usersResult.data ?? []) as UserFace[]);
      }

      if (fetchError) {
        if (isMissingClassificationColumnError(fetchError.message)) {
          const fallbackQuery = supabase
            .from("attendance")
            .select("id, student_id, full_name, attended_date, attended_at")
            .gte("attended_date", range.from)
            .lte("attended_date", range.to)
            .order("attended_at", { ascending: false });

          const { data: fallbackData, error: fallbackError } = await fallbackQuery;
          if (fallbackError) throw fallbackError;

          setLogs(
            ((fallbackData ?? []) as Array<Omit<AttendanceLog, "was_newcomer" | "attendance_context" | "attendance_group">>).map((row) => ({
              ...row,
              was_newcomer: false,
              attendance_context: null,
              attendance_group: null
            }))
          );
          setError("Attendance category columns are missing. Run supabase/schema.sql to enable service/event graphs.");
          return;
        }

        throw fetchError;
      }

      setLogs((data ?? []) as AttendanceLog[]);
    } catch (err: unknown) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(`Failed to fetch attendance records: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  const userNetworkMap = useMemo(() => buildStudentNetworkMap(users), [users]);

  const timelineRows = useMemo(() => {
    const map = new Map<string, ReturnType<typeof createEmptyNetworkCounts>>();

    for (const log of logs) {
      if (log.attended_date < MIN_ANALYTICS_DATE) continue;

      if (!map.has(log.attended_date)) {
        map.set(log.attended_date, createEmptyNetworkCounts());
      }

      const row = map.get(log.attended_date);
      if (!row) continue;

      const networkKey = userNetworkMap.get(log.student_id);
      if (!networkKey) continue;
      row[networkKey] += 1;
    }

    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-10)
      .map(([date, row]) => ({
        label: formatDateMMDDYY(date),
        ...row
      }));
  }, [formatDateMMDDYY, logs, userNetworkMap]);

  const newcomerCount = useMemo(() => logs.filter((log) => log.was_newcomer).length, [logs]);

  const recordsByGroup = useMemo(() => {
    const counts = createEmptyNetworkCounts();

    for (const log of logs) {
      const networkKey = userNetworkMap.get(log.student_id);
      if (!networkKey) continue;
      counts[networkKey] += 1;
    }

    return [
      { label: NETWORK_LABELS.kidsMinistry, value: counts.kidsMinistry, color: GROUP_COLORS.kidsMinistry },
      { label: NETWORK_LABELS.youthMinistry, value: counts.youthMinistry, color: GROUP_COLORS.youthMinistry },
      { label: NETWORK_LABELS.youngProfessionals, value: counts.youngProfessionals, color: GROUP_COLORS.youngProfessionals },
      { label: NETWORK_LABELS.mensNetwork, value: counts.mensNetwork, color: GROUP_COLORS.mensNetwork },
      { label: NETWORK_LABELS.womensNetwork, value: counts.womensNetwork, color: GROUP_COLORS.womensNetwork }
    ];
  }, [logs, userNetworkMap]);

  return (
    <div className="space-y-6 reveal">
      <section>
        <h1 className="page-title font-[var(--font-heading)]">Attendance Records</h1>
        <p className="page-subtitle">View and filter attendance logs by date.</p>
      </section>

      <section className="analytics-strip">
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Total Rows</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">{logs.length}</p>
        </article>
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Filter</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">{rangePreset === "custom" ? "Custom" : rangePreset.toUpperCase()}</p>
        </article>
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Status</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">{loading ? "Syncing" : "Ready"}</p>
        </article>
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Newcomer Scans</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">{newcomerCount}</p>
        </article>
      </section>

      <div className="card flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-wrap items-end gap-2">
          <button type="button" onClick={() => setRangePreset("today")} className={rangePreset === "today" ? "btn-primary" : "btn-ghost"}>Today</button>
          <button type="button" onClick={() => setRangePreset("7d")} className={rangePreset === "7d" ? "btn-primary" : "btn-ghost"}>Last 7 Days</button>
          <button type="button" onClick={() => setRangePreset("30d")} className={rangePreset === "30d" ? "btn-primary" : "btn-ghost"}>Last 30 Days</button>
          <button type="button" onClick={() => setRangePreset("custom")} className={rangePreset === "custom" ? "btn-primary" : "btn-ghost"}>Custom</button>
          {rangePreset === "custom" ? (
            <>
              <input type="date" min={MIN_ANALYTICS_DATE} value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="field-input max-w-[170px]" />
              <input type="date" min={MIN_ANALYTICS_DATE} value={toDate} onChange={(e) => setToDate(e.target.value)} className="field-input max-w-[170px]" />
            </>
          ) : null}
        </div>
        <button onClick={() => void fetchLogs()} className="btn-primary w-fit">
          Refresh
        </button>
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <p className="text-sm text-slate-600">Loading records...</p>
        ) : error ? (
          <div className="status-error">{error}</div>
        ) : logs.length === 0 ? (
          <p className="text-sm text-slate-600">No records found for the selected filter.</p>
        ) : (
          <table className="min-w-full border-separate border-spacing-y-2 text-sm">
            <thead>
              <tr className="text-left text-[#4f675e]">
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">ID</th>
                <th className="px-3 py-2 font-semibold">Attended</th>
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 font-semibold">Time</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                return (
                  <tr key={log.id} className="rounded-xl bg-white/85 text-[#30463f] shadow-[0_6px_16px_rgba(56,91,79,0.08)]">
                    <td className="rounded-l-xl px-3 py-2.5">{log.full_name}</td>
                    <td className="px-3 py-2.5">{log.student_id}</td>
                    <td className="px-3 py-2.5 text-xs text-[#4f675e]">{(userNetworkMap.get(log.student_id) ? NETWORK_LABELS[userNetworkMap.get(log.student_id)!] : "-")}</td>
                    <td className="px-3 py-2.5">{formatDateMMDDYY(log.attended_date)}</td>
                    <td className="rounded-r-xl px-3 py-2.5">{formatTimeHHmm(log.attended_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <section className="analytics-panel">
        <h2 className="font-[var(--font-heading)] text-lg text-[#23332d]">History Trend Frame</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => setAnalyticsView("mix")} className={analyticsView === "mix" ? "btn-primary" : "btn-ghost"}>100% Mix</button>
          <button type="button" onClick={() => setAnalyticsView("timeline")} className={analyticsView === "timeline" ? "btn-primary" : "btn-ghost"}>Timeline</button>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {analyticsView === "mix" ? (
            <StackedPercentageChart title="Daily Network Attendance" rows={timelineRows} emptyText="No network attendance data yet." />
          ) : (
            <StackedGroupTimeline title="Daily Network Timeline" rows={timelineRows} emptyText="No network timeline data yet." />
          )}
          <SimpleBarChart title="Attendance by Network" items={recordsByGroup} emptyText="No network attendance yet." />
        </div>
      </section>
    </div>
  );
}
