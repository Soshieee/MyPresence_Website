"use client";

// Simplified "Members" analytics module (P8).
// Church-wide member attendance: a ranked comparison table (optionally
// narrowed by network or age) and a "no rank" mode that answers "who attended
// this specific month / date / event". Clicking a member reveals the events
// they attended in the selected period. Reuses the shared ranking table built
// for the Lifegroup module.

import { useCallback, useEffect, useMemo, useState } from "react";
import { MemberRankingTable, type MemberRankingRow } from "@/components/analytics/member-ranking-table";
import { ageBucketFor, type AgeBucketKey } from "@/components/analytics/demographics";
import { normalizeAttendanceType } from "@/lib/attendance";
import {
  fetchAnalyticsEvents,
  fetchAnalyticsUsers,
  fetchAttendanceHistory,
  formatDayLabel,
  formatMonthKey,
  toDateKey,
  type AnalyticsEvent,
  type AnalyticsUser
} from "@/lib/analytics-data";
import { getNetworkFromProfile, NETWORK_LABELS, type NetworkKey } from "@/lib/networks";
import { hasSupabaseEnv } from "@/lib/supabase";
import type { AttendanceLog } from "@/types";

type Mode = "ranking" | "time";
type EventTypeFilter = "all" | NonNullable<AttendanceLog["attendance_context"]>;

const NETWORK_ORDER: NetworkKey[] = ["kidsMinistry", "youthMinistry", "youngProfessionals", "mensNetwork", "womensNetwork"];
const AGE_FILTER_OPTIONS: Array<{ key: AgeBucketKey; label: string }> = [
  { key: "kid", label: "Kid (0–13)" },
  { key: "youth", label: "Youth (14–26)" },
  { key: "young", label: "Young Professional (27–45)" },
  { key: "adult", label: "Adult (46+)" }
];

function occasionKey(log: AttendanceLog): string {
  const type = normalizeAttendanceType(log.attendance_context, log.attendance_group) ?? "Unknown";
  return `${log.attended_date}|${type}`;
}

export function MembersAnalyticsModule() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorText, setErrorText] = useState("");
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [users, setUsers] = useState<AnalyticsUser[]>([]);
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);

  const [mode, setMode] = useState<Mode>("ranking");
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("all");
  const [eventTypeFilter, setEventTypeFilter] = useState<EventTypeFilter>("all");
  const [networkFilter, setNetworkFilter] = useState<"all" | NetworkKey>("all");
  const [ageFilter, setAgeFilter] = useState<"all" | AgeBucketKey>("all");
  const [selectedEventId, setSelectedEventId] = useState("all");
  const [specificDate, setSpecificDate] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  // Occasion tabs (shown only when a specific date/event is selected): the
  // attended view and the "Absent" view of everyone who did not attend.
  const [occasionTab, setOccasionTab] = useState<"attended" | "absent">("attended");

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
        const [history, directory, eventRows] = await Promise.all([
          fetchAttendanceHistory(),
          fetchAnalyticsUsers(),
          fetchAnalyticsEvents()
        ]);
        if (!active) return;
        setLogs(history);
        setUsers(directory);
        setEvents(eventRows);
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
      if (log.attended_date.slice(0, 4) === effectiveYear) months.add(log.attended_date.slice(5, 7));
    }
    return Array.from(months).sort();
  }, [logs, effectiveYear]);

  const eventById = useMemo(() => {
    const map = new Map<string, AnalyticsEvent>();
    for (const event of events) map.set(event.id, event);
    return map;
  }, [events]);

  const yearScopedLogs = useMemo(() => {
    if (!effectiveYear) return [] as AttendanceLog[];
    const prefix = month === "all" ? effectiveYear : `${effectiveYear}-${month}`;
    return logs.filter((log) => log.attended_date.startsWith(prefix));
  }, [effectiveYear, logs, month]);

  const scopedLogs = useMemo(() => {
    let scoped = yearScopedLogs;
    if (mode === "time") {
      if (specificDate) scoped = scoped.filter((log) => log.attended_date === specificDate);
      if (selectedEventId !== "all") scoped = scoped.filter((log) => log.event_id === selectedEventId);
    }
    if (eventTypeFilter !== "all") {
      scoped = scoped.filter(
        (log) => normalizeAttendanceType(log.attendance_context, log.attendance_group) === eventTypeFilter
      );
    }
    return scoped;
  }, [eventTypeFilter, mode, selectedEventId, specificDate, yearScopedLogs]);

  const occasionDates = useMemo(() => {
    const map = new Map<string, string>();
    for (const log of scopedLogs) {
      const key = occasionKey(log);
      if (!map.has(key)) map.set(key, log.attended_date);
    }
    return map;
  }, [scopedLogs]);

  const eventOptions = useMemo(() => {
    if (!effectiveYear) return [] as AnalyticsEvent[];
    const prefix = month === "all" ? effectiveYear : `${effectiveYear}-${month}`;
    return events
      .filter((event) => event.event_date?.startsWith(prefix))
      .sort((a, b) => (b.event_date ?? "").localeCompare(a.event_date ?? ""));
  }, [events, month, effectiveYear]);

  // True when a specific date or event is chosen in "Specific time or event"
  // mode: the attended view then lists only members who attended the occasion.
  const attendeeOnly = mode === "time" && (specificDate !== "" || selectedEventId !== "all");

  const matchesMemberFilters = useCallback(
    (user: AnalyticsUser) => {
      if (networkFilter !== "all" && getNetworkFromProfile(user.age, user.gender) !== networkFilter) return false;
      if (ageFilter !== "all" && ageBucketFor(user.age) !== ageFilter) return false;
      return true;
    },
    [ageFilter, networkFilter]
  );

  // Period-wide scope (year + month + event type, without the specific
  // occasion) powers the Absent tab so its columns keep meaning: attended
  // counts and shares there describe the rest of the period.
  const periodScopeLogs = useMemo(() => {
    let scoped = yearScopedLogs;
    if (eventTypeFilter !== "all") {
      scoped = scoped.filter(
        (log) => normalizeAttendanceType(log.attendance_context, log.attendance_group) === eventTypeFilter
      );
    }
    return scoped;
  }, [eventTypeFilter, yearScopedLogs]);

  const periodOccasionDates = useMemo(() => {
    const map = new Map<string, string>();
    for (const log of periodScopeLogs) {
      const key = occasionKey(log);
      if (!map.has(key)) map.set(key, log.attended_date);
    }
    return map;
  }, [periodScopeLogs]);

  const periodStatsByMember = useMemo(() => {
    const stats = new Map<string, { count: number; last: string | null }>();
    const seen = new Set<string>();
    for (const log of periodScopeLogs) {
      const key = `${log.student_id}|${occasionKey(log)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = stats.get(log.student_id) ?? { count: 0, last: null };
      entry.count += 1;
      if (!entry.last || log.attended_date > entry.last) entry.last = log.attended_date;
      stats.set(log.student_id, entry);
    }
    return stats;
  }, [periodScopeLogs]);

  // Members present at the selected occasion (deduplicated by student).
  const attendeeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const log of scopedLogs) ids.add(log.student_id);
    return ids;
  }, [scopedLogs]);

  const rows = useMemo((): MemberRankingRow[] => {
    if (status !== "ready") return [];

    const attendedOccasionsByMember = new Map<string, { count: number; last: string | null }>();
    const seenOccasions = new Set<string>();
    for (const log of scopedLogs) {
      const key = `${log.student_id}|${occasionKey(log)}`;
      if (seenOccasions.has(key)) continue;
      seenOccasions.add(key);
      const entry = attendedOccasionsByMember.get(log.student_id) ?? { count: 0, last: null };
      entry.count += 1;
      if (!entry.last || log.attended_date > entry.last) entry.last = log.attended_date;
      attendedOccasionsByMember.set(log.student_id, entry);
    }

    const result: MemberRankingRow[] = [];
    for (const user of users) {
      if (!matchesMemberFilters(user)) continue;
      const attended = attendedOccasionsByMember.get(user.student_id);
      if (attendeeOnly && !attended) continue;

      const registered = toDateKey(user.created_at ?? null);
      const eligible =
        registered === null
          ? occasionDates.size
          : Array.from(occasionDates.values()).filter((date) => date >= registered).length;
      const attendedCount = attended?.count ?? 0;

      result.push({
        userId: user.student_id,
        name: user.full_name,
        meta: `${user.newcomer ? "Newcomer" : "Member"} • ${user.is_active === false ? "Inactive" : "Active"}`,
        attended: attendedCount,
        eligible,
        percent: eligible > 0 ? Math.round((attendedCount / eligible) * 1000) / 10 : null,
        lastAttended: attended?.last ?? null,
        joinUnknown: registered === null
      });
    }

    if (mode === "ranking") {
      result.sort((a, b) => {
        const percentA = a.percent ?? -1;
        const percentB = b.percent ?? -1;
        if (percentB !== percentA) return percentB - percentA;
        if (b.attended !== a.attended) return b.attended - a.attended;
        return a.name.localeCompare(b.name);
      });
    } else {
      result.sort((a, b) => a.name.localeCompare(b.name));
    }

    return result;
  }, [attendeeOnly, matchesMemberFilters, mode, occasionDates, scopedLogs, status, users]);

  // "Absent" tab: matching members with no attendance at the selected occasion.
  // Attended/eligible/percent describe the rest of the period; the share bar
  // fills by each member's absence share (100% − attendance%) in absentMode.
  const absentRows = useMemo((): MemberRankingRow[] => {
    if (status !== "ready" || !attendeeOnly) return [];

    // The occasion's own date, so members who were not registered yet on that
    // day can be left out — they could not have attended it.
    const occasionDate =
      specificDate !== "" ? specificDate : (eventById.get(selectedEventId)?.event_date ?? null);

    const result: MemberRankingRow[] = [];
    for (const user of users) {
      if (!matchesMemberFilters(user)) continue;
      if (attendeeIds.has(user.student_id)) continue;

      const registered = toDateKey(user.created_at ?? null);
      if (occasionDate && registered !== null && registered > occasionDate) continue;

      const eligible =
        registered === null
          ? periodOccasionDates.size
          : Array.from(periodOccasionDates.values()).filter((date) => date >= registered).length;
      const stats = periodStatsByMember.get(user.student_id);
      const attendedCount = stats?.count ?? 0;

      result.push({
        userId: user.student_id,
        name: user.full_name,
        meta: `${user.newcomer ? "Newcomer" : "Member"} • ${user.is_active === false ? "Inactive" : "Active"}`,
        attended: attendedCount,
        eligible,
        percent: eligible > 0 ? Math.round((attendedCount / eligible) * 1000) / 10 : null,
        lastAttended: stats?.last ?? null,
        joinUnknown: registered === null
      });
    }

    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [
    attendeeIds,
    attendeeOnly,
    eventById,
    matchesMemberFilters,
    periodOccasionDates,
    periodStatsByMember,
    selectedEventId,
    specificDate,
    status,
    users
  ]);

  const selectedMemberEvents = useMemo(() => {
    if (!selectedUserId) return [];
    const seen = new Set<string>();
    const entries: Array<{ date: string; type: string; eventTitle: string | null }> = [];
    for (const log of scopedLogs) {
      if (log.student_id !== selectedUserId) continue;
      const key = occasionKey(log);
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        date: log.attended_date,
        type: normalizeAttendanceType(log.attendance_context, log.attendance_group) ?? "Attendance",
        eventTitle: log.event_id ? eventById.get(log.event_id)?.title ?? null : null
      });
    }
    return entries.sort((a, b) => b.date.localeCompare(a.date));
  }, [eventById, scopedLogs, selectedUserId]);

  if (status === "loading") {
    return (
      <section className="analytics-panel">
        <h2 className="font-[var(--font-heading)] text-lg text-[#23332d]">Members</h2>
        <p className="mt-3 status-info">Loading member attendance...</p>
      </section>
    );
  }

  if (status === "error") {
    return (
      <section className="analytics-panel">
        <h2 className="font-[var(--font-heading)] text-lg text-[#23332d]">Members</h2>
        <p className="mt-3 status-error">The member analytics could not be loaded. {errorText}</p>
      </section>
    );
  }

  const showingAbsent = attendeeOnly && occasionTab === "absent";
  const activeRows = showingAbsent ? absentRows : rows;
  const totalAttendance = activeRows.reduce((sum, row) => sum + row.attended, 0);
  const percents = activeRows.map((row) => row.percent).filter((value): value is number => value !== null);
  const averagePercent =
    percents.length > 0 ? Math.round((percents.reduce((sum, value) => sum + value, 0) / percents.length) * 10) / 10 : null;
  const periodLabel = specificDate
    ? formatDayLabel(specificDate)
    : month === "all"
      ? effectiveYear
      : formatMonthKey(`${effectiveYear}-${month}`);
  const selectedEvent = selectedEventId === "all" ? null : eventById.get(selectedEventId) ?? null;
  const occasionLabel = selectedEvent?.title ?? (specificDate ? formatDayLabel(specificDate) : "this selection");
  const selectedMemberName = selectedUserId
    ? rows.find((row) => row.userId === selectedUserId)?.name ?? "Member"
    : "";

  return (
    <div className="space-y-4">
      <section className="card flex flex-wrap items-end gap-3">
        <div>
          <p className="field-label">Mode</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setMode("ranking");
                setSelectedUserId(null);
                setOccasionTab("attended");
              }}
              className={mode === "ranking" ? "btn-primary px-3 py-1.5 text-xs" : "btn-ghost px-3 py-1.5 text-xs"}
            >
              Rank members
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("time");
                setSelectedUserId(null);
                setOccasionTab("attended");
              }}
              className={mode === "time" ? "btn-primary px-3 py-1.5 text-xs" : "btn-ghost px-3 py-1.5 text-xs"}
            >
              Specific time or event
            </button>
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="members-year">Year</label>
          <select
            id="members-year"
            className="field-input max-w-[130px]"
            value={effectiveYear}
            onChange={(event) => {
              setYear(event.target.value);
              setMonth("all");
              setSpecificDate("");
              setSelectedEventId("all");
              setSelectedUserId(null);
              setOccasionTab("attended");
            }}
          >
            {yearOptions.length === 0 ? <option value="">No years with data</option> : null}
            {yearOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="field-label" htmlFor="members-month">Month</label>
          <select
            id="members-month"
            className="field-input max-w-[190px]"
            value={month}
            onChange={(event) => {
              setMonth(event.target.value);
              // Events and dates are scoped to the period — clear the stale
              // occasion picks the same way the year selector does.
              setSpecificDate("");
              setSelectedEventId("all");
              setSelectedUserId(null);
              setOccasionTab("attended");
            }}
          >
            <option value="all">Whole year</option>
            {monthOptions.map((option) => (
              <option key={option} value={option}>{formatMonthKey(`${effectiveYear}-${option}`)}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="field-label" htmlFor="members-event-type">Event type</label>
          <select
            id="members-event-type"
            className="field-input max-w-[190px]"
            value={eventTypeFilter}
            onChange={(event) => {
              setEventTypeFilter(event.target.value as EventTypeFilter);
              // A previously chosen event belongs to another type — fall back
              // to "Any event in period" instead of staying stuck on it.
              setSelectedEventId("all");
              setSelectedUserId(null);
              setOccasionTab("attended");
            }}
          >
            <option value="all">All event types</option>
            <option value="Sunday Service">Sunday Service</option>
            <option value="Prayer Meeting">Prayer Meeting</option>
            <option value="Rooftop">Rooftop</option>
            <option value="Men's Network">Men&apos;s Network</option>
            <option value="Women's Network">Women&apos;s Network</option>
          </select>
        </div>

        {mode === "ranking" ? (
          <>
            <div>
              <label className="field-label" htmlFor="members-network">Network</label>
              <select
                id="members-network"
                className="field-input max-w-[190px]"
                value={networkFilter}
                onChange={(event) => {
                  setNetworkFilter(event.target.value as "all" | NetworkKey);
                  setSelectedUserId(null);
                }}
              >
                <option value="all">All networks</option>
                {NETWORK_ORDER.map((key) => (
                  <option key={key} value={key}>{NETWORK_LABELS[key]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="members-age">Age</label>
              <select
                id="members-age"
                className="field-input max-w-[190px]"
                value={ageFilter}
                onChange={(event) => {
                  setAgeFilter(event.target.value as "all" | AgeBucketKey);
                  setSelectedUserId(null);
                }}
              >
                <option value="all">All ages</option>
                {AGE_FILTER_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="field-label" htmlFor="members-event">Specific event</label>
              <select
                id="members-event"
                className="field-input max-w-[260px]"
                value={selectedEventId}
                onChange={(event) => {
                  setSelectedEventId(event.target.value);
                  setSpecificDate("");
                  setSelectedUserId(null);
                  setOccasionTab("attended");
                }}
              >
                <option value="all">Any event in period</option>
                {eventOptions.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.title}
                    {event.event_date ? ` · ${formatDayLabel(event.event_date)}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="members-date">Specific date</label>
              <input
                id="members-date"
                type="date"
                className="field-input max-w-[170px]"
                value={specificDate}
                onChange={(event) => {
                  setSpecificDate(event.target.value);
                  setSelectedEventId("all");
                  setSelectedUserId(null);
                  setOccasionTab("attended");
                }}
              />
            </div>
          </>
        )}
      </section>

      {attendeeOnly ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setOccasionTab("attended")}
            className={showingAbsent ? "btn-ghost px-3 py-1.5 text-xs" : "btn-primary px-3 py-1.5 text-xs"}
          >
            Attended ({rows.length})
          </button>
          <button
            type="button"
            onClick={() => setOccasionTab("absent")}
            className={showingAbsent ? "btn-primary px-3 py-1.5 text-xs" : "btn-ghost px-3 py-1.5 text-xs"}
          >
            Absent ({absentRows.length})
          </button>
        </div>
      ) : null}

      <MemberRankingTable
        key={`${mode}-${showingAbsent ? "absent" : "attended"}`}
        title={
          showingAbsent
            ? `Absent Members — ${periodLabel}`
            : mode === "ranking"
              ? "Member Attendance Ranking"
              : `Member Attendance — ${periodLabel}`
        }
        summary={`${
          activeRows.length
        } ${activeRows.length === 1 ? "member" : "members"} • total attendance ${totalAttendance}${
          averagePercent === null ? "" : ` • average attendance ${averagePercent}%`
        }`}
        note={
          showingAbsent
            ? `Members who did not attend ${occasionLabel}. Attended and share columns describe the rest of the period; the Share of Period bar fills by how much of the period each member missed.`
            : mode === "ranking"
              ? "Eligible counts attendance occasions on or after the member's registration date. Click a member to see the events they attended."
              : selectedEvent
                ? `Showing members who attended ${selectedEvent.title}. Click a member to see their attended events.`
                : "No rank view: members are listed alphabetically. Click a member to see the events they attended."
        }
        rows={activeRows}
        showRank={mode === "ranking"}
        pageSize={5}
        absentMode={showingAbsent}
        emptyText={
          showingAbsent
            ? "Everyone attended this occasion — nobody is absent."
            : mode === "ranking"
              ? "No members match the current filters."
              : "No members attended this selection."
        }
        selectedUserId={showingAbsent ? null : selectedUserId}
        onSelectRow={
          showingAbsent
            ? undefined
            : (row) => setSelectedUserId((previous) => (previous === row.userId ? null : row.userId))
        }
      />

      {selectedUserId ? (
        <section className="analytics-panel">
          <h3 className="font-[var(--font-heading)] text-base text-[#23332d]">
            {selectedMemberName} — attended events ({periodLabel})
          </h3>
          {selectedMemberEvents.length === 0 ? (
            <p className="mt-2 text-sm text-[#5d736a]">No attendance recorded for this member in the period.</p>
          ) : (
            <ul className="mt-2 grid gap-1.5 text-sm text-[#315349]">
              {selectedMemberEvents.map((entry) => (
                <li key={`${entry.date}-${entry.type}`} className="rounded-lg bg-white/80 px-3 py-1.5">
                  {formatDayLabel(entry.date)} — {entry.type}
                  {entry.eventTitle ? ` — ${entry.eventTitle}` : ""}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
