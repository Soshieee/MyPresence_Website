"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { hasSupabaseEnv, supabase, supabaseEnvIssue } from "@/lib/supabase";
import { AttendanceLog, UserFace } from "@/types";
import LineChart from "@/components/line-chart";
import { GROUP_COLORS } from "@/lib/analytics-colors";
import { NETWORK_LABELS, NetworkKey, buildStudentNetworkMap, createEmptyNetworkCounts } from "@/lib/networks";

type RangePreset = "today" | "7d" | "30d" | "custom";
type AttendanceTypeFilter = "all" | "Sunday Service" | "Events" | "Prayer Meeting";
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
      "Prayer Meeting": 0,
      Unknown: 0
    };

    for (const log of filteredLogs) {
      if (log.attendance_context === "Sunday Service") counts["Sunday Service"] += 1;
      else if (log.attendance_context === "Events") counts.Events += 1;
      else if (log.attendance_context === "Prayer Meeting") counts["Prayer Meeting"] += 1;
      else counts.Unknown += 1;
    }

    return [
      { label: "Sunday Service", value: counts["Sunday Service"], color: "#1d4ed8" },
      { label: "Events", value: counts.Events, color: "#0f766e" },
      { label: "Prayer Meeting", value: counts["Prayer Meeting"], color: "#f59e0b" },
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

  const newcomerAttendeeCount = useMemo(
    () => new Set(filteredLogs.filter((log) => log.was_newcomer).map((log) => log.student_id)).size,
    [filteredLogs]
  );

  const newcomerCheckInCount = useMemo(
    () => filteredLogs.filter((log) => log.was_newcomer).length,
    [filteredLogs]
  );

  const returningAttendeeCount = useMemo(() => {
    const visitsByMember = new Map<string, number>();
    for (const log of filteredLogs) {
      visitsByMember.set(log.student_id, (visitsByMember.get(log.student_id) ?? 0) + 1);
    }
    return Array.from(visitsByMember.values()).filter((visits) => visits > 1).length;
  }, [filteredLogs]);

  const demographicAnalytics = useMemo(() => {
    const attendeeIds = new Set(filteredLogs.map((log) => log.student_id));
    const newcomerIds = new Set(filteredLogs.filter((log) => log.was_newcomer).map((log) => log.student_id));
    const ageCounts: Record<string, number> = { "Under 18": 0, "18-25": 0, "26-35": 0, "36+": 0 };
    const genderCounts: Record<string, number> = { Male: 0, Female: 0 };
    const newcomersByNetwork = createEmptyNetworkCounts();
    const countedNewcomers = new Set<string>();

    for (const studentId of attendeeIds) {
      const profile = userProfileMap.get(studentId);
      const networkKey = userNetworkMap.get(studentId);
      const age = profile?.age ?? null;
      const gender = profile?.gender;

      if (age !== null) {
        if (age < 18) ageCounts["Under 18"] += 1;
        else if (age <= 25) ageCounts["18-25"] += 1;
        else if (age <= 35) ageCounts["26-35"] += 1;
        else ageCounts["36+"] += 1;
      }

      if (gender === "Male" || gender === "Female") genderCounts[gender] += 1;

      if (networkKey && newcomerIds.has(studentId) && !countedNewcomers.has(studentId)) {
        newcomersByNetwork[networkKey] += 1;
        countedNewcomers.add(studentId);
      }
    }

    return {
      ageDistribution: Object.entries(ageCounts).map(([label, value]) => ({ label, value, color: "#0f766e" })),
      genderDistribution: [
        { label: "Male", value: genderCounts.Male, color: "#2563eb" },
        { label: "Female", value: genderCounts.Female, color: "#e11d48" }
      ],
      newcomersByNetwork: [
        { label: NETWORK_LABELS.kidsMinistry, value: newcomersByNetwork.kidsMinistry, color: GROUP_COLORS.kidsMinistry },
        { label: NETWORK_LABELS.youthMinistry, value: newcomersByNetwork.youthMinistry, color: GROUP_COLORS.youthMinistry },
        { label: NETWORK_LABELS.youngProfessionals, value: newcomersByNetwork.youngProfessionals, color: GROUP_COLORS.youngProfessionals },
        { label: NETWORK_LABELS.mensNetwork, value: newcomersByNetwork.mensNetwork, color: GROUP_COLORS.mensNetwork },
        { label: NETWORK_LABELS.womensNetwork, value: newcomersByNetwork.womensNetwork, color: GROUP_COLORS.womensNetwork }
      ]
    };
  }, [filteredLogs, userNetworkMap, userProfileMap]);

  return (
    <div className="space-y-6 reveal">
      <section>
        <h1 className="page-title font-[var(--font-heading)]">Attendance Analytics</h1>
        <p className="page-subtitle">Explore attendance trends, service mix, and attendee demographics.</p>
      </section>

      <section className="analytics-strip">
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Attendees</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">{filteredLogs.length}</p>
        </article>
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Newcomers</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">{newcomerAttendeeCount}</p>
        </article>
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Returning Attendees</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">{returningAttendeeCount}</p>
        </article>
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Newcomer Visits</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">{newcomerCheckInCount}</p>
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
          <button
            type="button"
            onClick={() => setAttendanceTypeFilter("Prayer Meeting")}
            className={attendanceTypeFilter === "Prayer Meeting" ? "btn-primary" : "btn-ghost"}
          >
            Prayer Meeting
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

      {error ? <div className="status-error">{error}</div> : null}
      {loading && !error ? <div className="status-info">Updating analytics...</div> : null}

      <section className="analytics-panel">
        <h2 className="font-[var(--font-heading)] text-lg text-[#23332d]">Analytics Overview</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <LineChart title="Attendees by Day (Last 10)" items={dailyTotals} emptyText="No daily attendance yet." />
          <LineChart title="Attendees by Ministry" items={recordsByGroup} emptyText="No network attendance yet." />
          <LineChart title="Newcomer Visits by Ministry" items={newcomerByGroup} emptyText="No newcomer attendance yet." />
          <LineChart title="Attendees by Attendance Type" items={attendanceByContext} emptyText="No attendance type data yet." />
          <LineChart title="Attendees by Service or Event" items={attendanceByGroup} emptyText="No attendance group data yet." />
          <LineChart title="Newcomers by Ministry" items={demographicAnalytics.newcomersByNetwork} emptyText="No newcomer profiles available." />
          <LineChart title="Attendee Age Distribution" items={demographicAnalytics.ageDistribution} emptyText="No age data available." />
          <LineChart title="Attendee Gender Distribution" items={demographicAnalytics.genderDistribution} emptyText="No gender data available." />
        </div>
      </section>
    </div>
  );
}
