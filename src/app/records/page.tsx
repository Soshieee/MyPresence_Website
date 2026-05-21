"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { hasSupabaseEnv, supabase, supabaseEnvIssue } from "@/lib/supabase";
import { AttendanceLog, UserFace } from "@/types";
import SimpleBarChart from "@/components/simple-bar-chart";
import { GROUP_COLORS } from "@/lib/analytics-colors";
import { NETWORK_LABELS, NetworkKey, buildStudentNetworkMap, createEmptyNetworkCounts } from "@/lib/networks";

type RangePreset = "today" | "7d" | "30d" | "custom";
type AttendanceTypeFilter = "all" | "Sunday Service" | "Events";
const MIN_ANALYTICS_DATE = "2026-01-01";

type AttendanceGroup =
  | "First Service"
  | "Second Service"
  | "Prayer Meeting"
  | "Rooftop"
  | "Men's Network"
  | "Women's Network";

const ATTENDANCE_GROUPS: Array<{ label: AttendanceGroup; color: string }> = [
  { label: "First Service", color: "#2563eb" },
  { label: "Second Service", color: "#0ea5e9" },
  { label: "Prayer Meeting", color: "#f59e0b" },
  { label: "Rooftop", color: "#8b5cf6" },
  { label: "Men's Network", color: "#10b981" },
  { label: "Women's Network", color: "#ef4444" }
];

function normalizeAttendanceGroup(label: string | null): AttendanceGroup | null {
  if (label === "Male") return "Men's Network";
  if (label === "Female") return "Women's Network";
  if (!label) return null;
  return label as AttendanceGroup;
}

function isMissingClassificationColumnError(message: string) {
  return /column\s+attendance\.(was_newcomer|attendance_context|attendance_group)\s+does not exist/i.test(message);
}

export default function AttendanceRecordsPage() {
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [users, setUsers] = useState<UserFace[]>([]);
  const [rangePreset, setRangePreset] = useState<RangePreset>("7d");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedNetworks, setSelectedNetworks] = useState<NetworkKey[]>([]);
  const [attendanceTypeFilter, setAttendanceTypeFilter] = useState<AttendanceTypeFilter>("all");
  const [searchTerm, setSearchTerm] = useState("");
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

  const userProfileMap = useMemo(() => new Map(users.map((user) => [user.student_id, user])), [users]);

  const newcomerCount = useMemo(() => logs.filter((log) => log.was_newcomer).length, [logs]);

  const selectedNetworkSet = useMemo(() => new Set(selectedNetworks), [selectedNetworks]);
  const normalizedSearch = useMemo(() => searchTerm.trim().toLowerCase(), [searchTerm]);

  const toggleNetwork = useCallback((key: NetworkKey) => {
    setSelectedNetworks((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
  }, []);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const userNetwork = userNetworkMap.get(log.student_id);
      const matchesNetwork =
        selectedNetworkSet.size === 0 || (userNetwork ? selectedNetworkSet.has(userNetwork) : false);

      const matchesAttendanceType =
        attendanceTypeFilter === "all" || log.attendance_context === attendanceTypeFilter;

      const matchesSearch =
        normalizedSearch.length === 0 ||
        log.full_name.toLowerCase().includes(normalizedSearch) ||
        log.student_id.toLowerCase().includes(normalizedSearch);

      return matchesNetwork && matchesAttendanceType && matchesSearch;
    });
  }, [attendanceTypeFilter, logs, normalizedSearch, selectedNetworkSet, userNetworkMap]);

  const dailyTotals = useMemo(() => {
    const map = new Map<string, number>();

    for (const log of filteredLogs) {
      if (log.attended_date < MIN_ANALYTICS_DATE) continue;
      map.set(log.attended_date, (map.get(log.attended_date) ?? 0) + 1);
    }

    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-10)
      .map(([date, value]) => ({ label: formatDateMMDDYY(date), value }));
  }, [filteredLogs, formatDateMMDDYY]);

  const recordsByGroup = useMemo(() => {
    const counts = createEmptyNetworkCounts();

    for (const log of filteredLogs) {
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
  }, [filteredLogs, userNetworkMap]);

  const newcomerByGroup = useMemo(() => {
    const counts = createEmptyNetworkCounts();

    for (const log of filteredLogs) {
      if (!log.was_newcomer) continue;
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
  }, [filteredLogs, userNetworkMap]);

  const attendanceByContext = useMemo(() => {
    const counts = {
      "Sunday Service": 0,
      Events: 0,
      Unknown: 0
    };

    for (const log of filteredLogs) {
      if (log.attendance_context === "Sunday Service") counts["Sunday Service"] += 1;
      else if (log.attendance_context === "Events") counts.Events += 1;
      else counts.Unknown += 1;
    }

    return [
      { label: "Sunday Service", value: counts["Sunday Service"], color: "#1d4ed8" },
      { label: "Events", value: counts.Events, color: "#0f766e" },
      { label: "Unknown", value: counts.Unknown, color: "#64748b" }
    ];
  }, [filteredLogs]);

  const attendanceByGroup = useMemo(() => {
    const counts: Record<AttendanceGroup, number> = {
      "First Service": 0,
      "Second Service": 0,
      "Prayer Meeting": 0,
      Rooftop: 0,
      "Men's Network": 0,
      "Women's Network": 0
    };

    for (const log of filteredLogs) {
      const group = normalizeAttendanceGroup(log.attendance_group);
      if (!group) continue;
      counts[group] += 1;
    }

    return ATTENDANCE_GROUPS.map((entry) => ({
      label: entry.label,
      value: counts[entry.label],
      color: entry.color
    }));
  }, [filteredLogs]);

  const demographicByNetwork = useMemo(() => {
    const grouped: Record<NetworkKey, Array<{
      id: string;
      name: string;
      age: string;
      ageValue: number | null;
      gender: string;
      context: string;
      group: string;
      date: string;
      time: string;
      isNewcomer: boolean;
    }>> = {
      kidsMinistry: [],
      youthMinistry: [],
      youngProfessionals: [],
      mensNetwork: [],
      womensNetwork: []
    };

    for (const log of filteredLogs) {
      const networkKey = userNetworkMap.get(log.student_id);
      if (!networkKey) continue;
      const profile = userProfileMap.get(log.student_id);

      grouped[networkKey].push({
        id: log.student_id,
        name: log.full_name,
        age: profile?.age ? `${profile.age}` : "-",
        ageValue: profile?.age ?? null,
        gender: profile?.gender ?? "-",
        context: log.attendance_context ?? "-",
        group: normalizeAttendanceGroup(log.attendance_group) ?? "-",
        date: formatDateMMDDYY(log.attended_date),
        time: formatTimeHHmm(log.attended_at),
        isNewcomer: log.was_newcomer
      });
    }

    return [
      { key: "kidsMinistry", label: NETWORK_LABELS.kidsMinistry, rows: grouped.kidsMinistry },
      { key: "youthMinistry", label: NETWORK_LABELS.youthMinistry, rows: grouped.youthMinistry },
      { key: "youngProfessionals", label: NETWORK_LABELS.youngProfessionals, rows: grouped.youngProfessionals },
      { key: "mensNetwork", label: NETWORK_LABELS.mensNetwork, rows: grouped.mensNetwork },
      { key: "womensNetwork", label: NETWORK_LABELS.womensNetwork, rows: grouped.womensNetwork }
    ];
  }, [filteredLogs, formatDateMMDDYY, formatTimeHHmm, userNetworkMap, userProfileMap]);

  return (
    <div className="space-y-6 reveal">
      <section>
        <h1 className="page-title font-[var(--font-heading)]">Attendance Records</h1>
        <p className="page-subtitle">View and filter attendance logs by date.</p>
      </section>

      <section className="analytics-strip">
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Visible Rows</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">{filteredLogs.length}</p>
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
        <button onClick={() => window.print()} className="btn-ghost w-fit">
          Print / Save PDF
        </button>
      </div>

      <div className="card space-y-3">
        <p className="field-label">Filter By Ministry</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSelectedNetworks([])}
            className={selectedNetworks.length === 0 ? "btn-primary" : "btn-ghost"}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => toggleNetwork("kidsMinistry")}
            className={selectedNetworkSet.has("kidsMinistry") ? "btn-primary" : "btn-ghost"}
          >
            {NETWORK_LABELS.kidsMinistry}
          </button>
          <button
            type="button"
            onClick={() => toggleNetwork("youthMinistry")}
            className={selectedNetworkSet.has("youthMinistry") ? "btn-primary" : "btn-ghost"}
          >
            {NETWORK_LABELS.youthMinistry}
          </button>
          <button
            type="button"
            onClick={() => toggleNetwork("youngProfessionals")}
            className={selectedNetworkSet.has("youngProfessionals") ? "btn-primary" : "btn-ghost"}
          >
            {NETWORK_LABELS.youngProfessionals}
          </button>
          <button
            type="button"
            onClick={() => toggleNetwork("mensNetwork")}
            className={selectedNetworkSet.has("mensNetwork") ? "btn-primary" : "btn-ghost"}
          >
            {NETWORK_LABELS.mensNetwork}
          </button>
          <button
            type="button"
            onClick={() => toggleNetwork("womensNetwork")}
            className={selectedNetworkSet.has("womensNetwork") ? "btn-primary" : "btn-ghost"}
          >
            {NETWORK_LABELS.womensNetwork}
          </button>
        </div>

        <p className="field-label">Filter By Attendance Type</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setAttendanceTypeFilter("all")}
            className={attendanceTypeFilter === "all" ? "btn-primary" : "btn-ghost"}
          >
            All Types
          </button>
          <button
            type="button"
            onClick={() => setAttendanceTypeFilter("Sunday Service")}
            className={attendanceTypeFilter === "Sunday Service" ? "btn-primary" : "btn-ghost"}
          >
            Sunday Service
          </button>
          <button
            type="button"
            onClick={() => setAttendanceTypeFilter("Events")}
            className={attendanceTypeFilter === "Events" ? "btn-primary" : "btn-ghost"}
          >
            Events
          </button>
        </div>

        <div>
          <label className="field-label" htmlFor="record-search">
            Search Name Or ID
          </label>
          <input
            id="record-search"
            type="text"
            className="field-input"
            placeholder="Type name or member ID"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <p className="text-sm text-slate-600">Loading records...</p>
        ) : error ? (
          <div className="status-error">{error}</div>
        ) : filteredLogs.length === 0 ? (
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
              {filteredLogs.map((log) => {
                const isNewcomer = log.was_newcomer;

                return (
                  <tr
                    key={log.id}
                    className={`rounded-xl bg-white/85 text-[#30463f] shadow-[0_6px_16px_rgba(56,91,79,0.08)] ${isNewcomer ? "border-l-4 border-[#f97316]" : ""}`}
                  >
                    <td className="rounded-l-xl px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span>{log.full_name}</span>
                        {isNewcomer ? (
                          <span className="rounded-full bg-[#ffedd5] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9a3412]">Newcomer</span>
                        ) : null}
                      </div>
                    </td>
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
        <h2 className="font-[var(--font-heading)] text-lg text-[#23332d]">Analytics Overview</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <SimpleBarChart title="Attendance by Day (Last 10)" items={dailyTotals} emptyText="No daily attendance yet." />
          <SimpleBarChart title="Attendance by Network" items={recordsByGroup} emptyText="No network attendance yet." />
          <SimpleBarChart title="Newcomers by Network" items={newcomerByGroup} emptyText="No newcomer attendance yet." />
          <SimpleBarChart title="Attendance by Type" items={attendanceByContext} emptyText="No attendance type data yet." />
          <SimpleBarChart title="Attendance by Service/Event" items={attendanceByGroup} emptyText="No attendance group data yet." />
        </div>
      </section>

      <section className="analytics-panel">
        <div className="rounded-3xl border border-[#cbd8d2] bg-[radial-gradient(circle_at_top,_#f6fbf9,_#eef5f1_45%,_#e5efe9_100%)] px-5 py-4 shadow-[0_16px_40px_rgba(36,54,47,0.12)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#517065]">Demographics Studio</p>
              <h2 className="mt-2 font-[var(--font-heading)] text-xl text-[#203029]">Demographics by Ministry</h2>
            </div>
          </div>
          <p className="mt-3 max-w-3xl text-sm text-[#516a61]">Trace each ministry&apos;s people by age, gender, and where they attended within the selected range.</p>
        </div>
        <div className="mt-6 space-y-8">
          {demographicByNetwork.map((group) => (
            <div key={group.key} className="relative overflow-hidden rounded-3xl border border-[#d2dfd9] bg-white/85 p-5 shadow-[0_18px_44px_rgba(49,83,73,0.16)]">
              <div className="absolute left-0 top-0 h-full w-1.5 bg-gradient-to-b from-[#385b4f] via-[#6aa191] to-[#dce9e4]" />
              <div className="relative mb-4 flex flex-wrap items-start justify-between gap-3 pl-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5d736a]">Ministry Snapshot</p>
                  <h3 className="mt-1 text-lg font-semibold text-[#24362f]">{group.label}</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-[#cad7d2] bg-[#eef5f1] px-3 py-1 text-xs font-semibold text-[#355046]">{group.rows.length} records</span>
                </div>
              </div>
              <div className="mb-4 grid gap-3 pl-3 sm:grid-cols-3">
                {(() => {
                  const newcomerCount = group.rows.filter((row) => row.isNewcomer).length;
                  const ageValues = group.rows.map((row) => row.ageValue).filter((value): value is number => value !== null);
                  const avgAge = ageValues.length > 0 ? Math.round(ageValues.reduce((sum, value) => sum + value, 0) / ageValues.length) : null;
                  const newcomerPct = group.rows.length > 0 ? Math.round((newcomerCount / group.rows.length) * 100) : 0;

                  return (
                    <>
                      <div className="rounded-2xl border border-[#d6e1dc] bg-[#f4faf7] px-4 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5d736a]">Avg Age</p>
                        <p className="mt-1 text-xl font-semibold text-[#24362f]">{avgAge ?? "-"}</p>
                      </div>
                      <div className="rounded-2xl border border-[#d6e1dc] bg-[#f4faf7] px-4 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5d736a]">Newcomers</p>
                        <p className="mt-1 text-xl font-semibold text-[#24362f]">{newcomerCount}</p>
                      </div>
                      <div className="rounded-2xl border border-[#d6e1dc] bg-[#f4faf7] px-4 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5d736a]">Newcomer %</p>
                        <p className="mt-1 text-xl font-semibold text-[#24362f]">{newcomerPct}%</p>
                      </div>
                    </>
                  );
                })()}
              </div>
              {group.rows.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[#c6d4cf] bg-[#f6faf8] px-4 py-6 text-sm text-[#5d736a]">
                  No attendance records for this ministry.
                </div>
              ) : (
                <>
                  <div className="grid gap-3 md:hidden">
                    {group.rows.map((row, index) => (
                      <div key={`${row.id}-${row.date}-${row.time}-${index}`} className="rounded-2xl border border-[#d7e3de] bg-white p-4 shadow-[0_10px_24px_rgba(49,83,73,0.12)]">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#5d736a]">Member</p>
                            <p className="mt-1 text-base font-semibold text-[#23332d]">{row.name}</p>
                          </div>
                          {row.isNewcomer ? (
                            <span className="rounded-full bg-[#ffedd5] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9a3412]">Newcomer</span>
                          ) : null}
                        </div>
                        <div className="mt-3 grid gap-2 text-sm text-[#3d564c]">
                          <div className="flex items-center justify-between">
                            <span className="text-xs uppercase tracking-[0.18em] text-[#5d736a]">ID</span>
                            <span className="font-semibold text-[#2b3f37]">{row.id}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs uppercase tracking-[0.18em] text-[#5d736a]">Age / Gender</span>
                            <span className="font-semibold text-[#2b3f37]">{row.age} · {row.gender}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs uppercase tracking-[0.18em] text-[#5d736a]">Attendance</span>
                            <span className="font-semibold text-[#2b3f37]">{row.context}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs uppercase tracking-[0.18em] text-[#5d736a]">Group</span>
                            <span className="font-semibold text-[#2b3f37]">{row.group}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs uppercase tracking-[0.18em] text-[#5d736a]">Date / Time</span>
                            <span className="font-semibold text-[#2b3f37]">{row.date} · {row.time}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="hidden overflow-x-auto rounded-2xl border border-[#d7e3de] bg-white md:block">
                    <table className="min-w-full border-separate border-spacing-0 text-sm">
                      <thead className="bg-[#eff6f2] text-left text-[#3f5950]">
                        <tr>
                          <th className="sticky top-0 z-10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">Name</th>
                          <th className="sticky top-0 z-10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">ID</th>
                          <th className="sticky top-0 z-10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">Age</th>
                          <th className="sticky top-0 z-10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">Gender</th>
                          <th className="sticky top-0 z-10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">Attendance</th>
                          <th className="sticky top-0 z-10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">Group</th>
                          <th className="sticky top-0 z-10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">Date</th>
                          <th className="sticky top-0 z-10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((row, index) => (
                          <tr key={`${row.id}-${row.date}-${row.time}-${index}`} className={`${index % 2 === 0 ? "bg-white" : "bg-[#f7fbf9]"} group transition-colors hover:bg-[#eaf4ef]`}>
                            <td className="px-4 py-3 font-semibold text-[#23332d]">
                              <span className="inline-flex items-center gap-2">
                                <span className="h-2.5 w-2.5 rounded-full bg-[#385b4f]" />
                                {row.name}
                              </span>
                              {row.isNewcomer ? (
                                <span className="ml-2 inline-flex items-center rounded-full bg-[#ffedd5] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9a3412]">Newcomer</span>
                              ) : null}
                            </td>
                            <td className="px-4 py-3 text-[#3d564c]">{row.id}</td>
                            <td className="px-4 py-3 text-[#3d564c]">{row.age}</td>
                            <td className="px-4 py-3">
                              <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${row.gender === "Male" ? "border-[#a5b4fc] bg-[#eef2ff] text-[#3730a3]" : row.gender === "Female" ? "border-[#f9a8d4] bg-[#fdf2f8] text-[#9d174d]" : "border-[#cbd5f5] bg-[#f8fafc] text-[#475569]"}`}>
                                {row.gender}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${row.context === "Sunday Service" ? "border-[#a7f3d0] bg-[#ecfdf5] text-[#065f46]" : row.context === "Events" ? "border-[#fecdd3] bg-[#fff1f2] text-[#9f1239]" : "border-[#cbd5f5] bg-[#f8fafc] text-[#475569]"}`}>
                                {row.context}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className="rounded-full border border-[#c8d6d0] bg-[#eef5f1] px-2 py-0.5 text-xs font-semibold text-[#355046]">{row.group}</span>
                            </td>
                            <td className="px-4 py-3 text-[#3d564c]">{row.date}</td>
                            <td className="px-4 py-3 text-[#3d564c]">
                              {row.time}
                              <span className="ml-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#5d736a] opacity-0 transition-opacity group-hover:opacity-100">Details</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
