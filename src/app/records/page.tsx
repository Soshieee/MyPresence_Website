"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { hasSupabaseEnv, supabase, supabaseEnvIssue } from "@/lib/supabase";
import { AttendanceLog } from "@/types";
import SimpleBarChart from "@/components/simple-bar-chart";
import StackedGroupTimeline from "@/components/stacked-group-timeline";
import StackedPercentageChart from "@/components/stacked-percentage-chart";
import { GROUP_COLORS } from "@/lib/analytics-colors";

type RangePreset = "today" | "7d" | "30d" | "custom";
type AnalyticsView = "timeline" | "mix";
const MIN_ANALYTICS_DATE = "2026-01-01";

function isMissingClassificationColumnError(message: string) {
  return /column\s+attendance\.(was_newcomer|attendance_context|attendance_group)\s+does not exist/i.test(message);
}

export default function AttendanceRecordsPage() {
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
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
      let query = supabase
        .from("attendance")
        .select("id, student_id, full_name, was_newcomer, attendance_context, attendance_group, attended_date, attended_at")
        .gte("attended_date", range.from)
        .lte("attended_date", range.to)
        .order("attended_at", { ascending: false });

      const { data, error: fetchError } = await query;

      if (fetchError) {
        if (isMissingClassificationColumnError(fetchError.message)) {
          let fallbackQuery = supabase
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

  const recordsByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const log of logs) {
      map.set(log.attended_date, (map.get(log.attended_date) ?? 0) + 1);
    }

    return Array.from(map.entries())
      .filter(([label]) => label >= MIN_ANALYTICS_DATE)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-7)
      .map(([label, value]) => ({ label: formatDateMMDDYY(label), value, color: "#385b4f" }));
  }, [formatDateMMDDYY, logs]);

  const timelineRows = useMemo(() => {
    const map = new Map<string, { firstService: number; secondService: number; rooftop: number; male: number; female: number }>();

    for (const log of logs) {
      if (log.attended_date < MIN_ANALYTICS_DATE) continue;

      if (!map.has(log.attended_date)) {
        map.set(log.attended_date, { firstService: 0, secondService: 0, rooftop: 0, male: 0, female: 0 });
      }

      const row = map.get(log.attended_date);
      if (!row) continue;

      if (log.attendance_context === "Sunday Service" && log.attendance_group === "First Service") row.firstService += 1;
      if (log.attendance_context === "Sunday Service" && log.attendance_group === "Second Service") row.secondService += 1;
      if (log.attendance_context === "Events" && log.attendance_group === "Rooftop") row.rooftop += 1;
      if (log.attendance_context === "Events" && log.attendance_group === "Male") row.male += 1;
      if (log.attendance_context === "Events" && log.attendance_group === "Female") row.female += 1;
    }

    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-10)
      .map(([date, row]) => ({
        label: formatDateMMDDYY(date),
        ...row
      }));
  }, [formatDateMMDDYY, logs]);

  const newcomerCount = useMemo(() => logs.filter((log) => log.was_newcomer).length, [logs]);

  const recordsByGroup = useMemo(() => {
    const counts = {
      "1st Service": 0,
      "2nd Service": 0,
      Rooftop: 0,
      Male: 0,
      Female: 0
    };

    for (const log of logs) {
      if (log.attendance_context === "Sunday Service" && log.attendance_group === "First Service") counts["1st Service"] += 1;
      if (log.attendance_context === "Sunday Service" && log.attendance_group === "Second Service") counts["2nd Service"] += 1;
      if (log.attendance_context === "Events" && log.attendance_group === "Rooftop") counts.Rooftop += 1;
      if (log.attendance_context === "Events" && log.attendance_group === "Male") counts.Male += 1;
      if (log.attendance_context === "Events" && log.attendance_group === "Female") counts.Female += 1;
    }

    return [
      { label: "1st Service", value: counts["1st Service"], color: GROUP_COLORS.firstService },
      { label: "2nd Service", value: counts["2nd Service"], color: GROUP_COLORS.secondService },
      { label: "Rooftop", value: counts.Rooftop, color: GROUP_COLORS.rooftop },
      { label: "Male", value: counts.Male, color: GROUP_COLORS.male },
      { label: "Female", value: counts.Female, color: GROUP_COLORS.female }
    ];
  }, [logs]);

  return (
    <div className="space-y-6 reveal">
      <section>
        <h1 className="page-title font-[var(--font-heading)]">Attendance Records</h1>
        <p className="page-subtitle">View and filter attendance logs by date.</p>
      </section>

      <section className="analytics-strip">
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Total Rows</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl font-semibold text-[#22322d]">{logs.length}</p>
        </article>
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Filter</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl font-semibold text-[#22322d]">{rangePreset === "custom" ? "Custom" : rangePreset.toUpperCase()}</p>
        </article>
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Status</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl font-semibold text-[#22322d]">{loading ? "Syncing" : "Ready"}</p>
        </article>
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Newcomer Scans</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl font-semibold text-[#22322d]">{newcomerCount}</p>
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
                <th className="px-3 py-2 font-semibold">Category</th>
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
                    <td className="px-3 py-2.5 text-xs text-[#4f675e]">{log.attendance_group ?? "-"}</td>
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
        <h2 className="font-[var(--font-heading)] text-lg font-semibold text-[#23332d]">History Trend Frame</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => setAnalyticsView("mix")} className={analyticsView === "mix" ? "btn-primary" : "btn-ghost"}>100% Mix</button>
          <button type="button" onClick={() => setAnalyticsView("timeline")} className={analyticsView === "timeline" ? "btn-primary" : "btn-ghost"}>Timeline</button>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {analyticsView === "mix" ? (
            <StackedPercentageChart title="Daily Group Mix (100%)" rows={timelineRows} emptyText="No grouped mix data yet." />
          ) : (
            <StackedGroupTimeline title="Daily Group Timeline" rows={timelineRows} emptyText="No grouped timeline data yet." />
          )}
          <SimpleBarChart title="Attendance by Group" items={recordsByGroup} emptyText="No categorized attendance yet." />
        </div>
      </section>
    </div>
  );
}
