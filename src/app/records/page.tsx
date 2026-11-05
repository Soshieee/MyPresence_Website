"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { hasSupabaseEnv, supabase, supabaseEnvIssue } from "@/lib/supabase";
import { AttendanceLog, UserFace } from "@/types";
import LineChart from "@/components/line-chart";
import { GROUP_COLORS } from "@/lib/analytics-colors";
import { NETWORK_LABELS, NetworkKey, buildStudentNetworkMap, createEmptyNetworkCounts } from "@/lib/networks";
import {
  ATTENDANCE_TYPES,
  AttendanceType,
  isMissingEventTypeColumnError,
  isMissingServiceTypeColumnError,
  normalizeAttendanceType,
  normalizeServiceType,
  serviceSessionForLog
} from "@/lib/attendance";
import { toLocalDateInput } from "@/lib/date";
import {
  downloadCsv,
  openReportWindow,
  toCsv,
  type ReportTable
} from "@/lib/records-report";

type RangePreset = "today" | "7d" | "30d" | "custom";
type RecordsView = "attendance" | "lifegroups";
type AttendanceTypeFilter = "all" | AttendanceType;
type EventLookup = {
  title: string;
  eventType: string | null;
};
const MIN_ANALYTICS_DATE = "2026-01-01";
const RECORDS_PAGE_SIZE = 25;
const LIFEGROUP_PANEL_PAGE_SIZE = 5;

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

const LINKED_EVENT_COLORS = ["#0f766e", "#2563eb", "#8b5cf6", "#f59e0b", "#e11d48", "#0891b2"];

type LinkedEvent = {
  id: string;
  title: string;
  event_date: string | null;
};

type Lifegroup = {
  id: string;
  name: string;
  description?: string | null;
  leader_id?: string | null;
  status?: string | null;
};

type LifegroupMemberRow = {
  id?: string;
  lifegroup_id: string;
  user_id: string;
  role?: string | null;
  status?: string | null;
  joined_at?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
};

type ProfileRow = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
};

type LifegroupActivityRow = {
  id: string;
  lifegroup_id: string;
  title?: string | null;
  description?: string | null;
  location?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  status?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
};

type LifegroupRsvpRow = {
  id?: string;
  activity_id: string;
  user_id: string;
  response?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
};

type LifegroupAttendanceRow = {
  id?: string;
  activity_id?: string | null;
  lifegroup_id?: string | null;
  user_id: string;
  status?: string | null;
  attended_at?: string | null;
  checked_in_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
};

type LifegroupReportRow = Record<string, unknown>;
type LifegroupRangePreset = "today" | "7d" | "30d" | "custom";

function rowString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function rowBoolean(row: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "t", "yes", "y", "1", "present", "attended", "checked_in"].includes(normalized)) return true;
      if (["false", "f", "no", "n", "0", "absent", "missed", "not_present"].includes(normalized)) return false;
    }
  }
  return null;
}

function rowNumber(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function dateKey(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return toLocalDateInput(parsed);
}

function activityDate(activity: LifegroupActivityRow | undefined): string | null {
  if (!activity) return null;
  return dateKey(rowString(activity, ["starts_at", "activity_date", "date", "created_at"]));
}

function attendanceDate(
  row: LifegroupAttendanceRow,
  activityById: Map<string, LifegroupActivityRow>
): string | null {
  const direct = dateKey(
    rowString(row, ["attended_at", "checked_in_at", "attendance_date", "date", "recorded_at", "created_at"])
  );
  if (direct) return direct;
  const activity = row.activity_id ? activityById.get(row.activity_id) : undefined;
  return activityDate(activity);
}

function isPresentAttendance(row: LifegroupAttendanceRow) {
  const status = rowString(row, ["status", "attendance_status", "state"])?.toLowerCase() ?? "";
  if (status) {
    if (
      [
        "absent",
        "not_present",
        "no_show",
        "noshow",
        "missed",
        "declined",
        "cancelled",
        "canceled",
        "excused",
        "pending",
        "registered",
        "invited",
        "waitlist",
        "maybe",
        "unknown"
      ].includes(
        status
      )
    ) {
      return false;
    }
    if (
      ["present", "attended", "checked_in", "checkedin", "late", "here", "yes", "true", "1", "completed", "complete"].includes(
        status
      )
    ) {
      return true;
    }
  }

  const flag = rowBoolean(row, ["present", "attended", "is_present", "checked_in"]);
  if (flag !== null) return flag;

  // A row in lifegroup_attendance is an attendance record even when the
  // deployment does not store an explicit present/absent flag.
  return true;
}

function isActiveMembership(row: LifegroupMemberRow) {
  const status = (row.status ?? "").trim().toLowerCase();
  if (!status) return true;
  return status === "active" || status === "approved";
}

function normalizeRsvpResponse(value: string | null): "yes" | "no" | "maybe" | "other" {
  const normalized = (value ?? "").trim().toLowerCase();
  if (["yes", "y", "going", "attend", "attending", "accepted"].includes(normalized)) return "yes";
  if (["no", "n", "not_going", "declined", "cannot_attend", "not attending"].includes(normalized)) return "no";
  if (["maybe", "tentative", "undecided"].includes(normalized)) return "maybe";
  return "other";
}

function dateInRange(value: string | null, from: string, to: string) {
  return Boolean(value && value >= from && value <= to);
}

function displayProfileName(profile: ProfileRow | undefined) {
  const name = [profile?.first_name, profile?.last_name]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .trim();
  return name || "Name unavailable";
}

function normalizeAttendanceGroup(label: string | null): AttendanceGroup | null {
  if (label === "Male") return "Men's Network";
  if (label === "Female") return "Women's Network";
  if (!label) return null;
  return label as AttendanceGroup;
}

function isMissingClassificationColumnError(message: string) {
  return /column\s+attendance\.(was_newcomer|attendance_context|attendance_group|event_id)\s+does not exist/i.test(message);
}

export default function AttendanceRecordsPage() {
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [users, setUsers] = useState<UserFace[]>([]);
  const [linkedEvents, setLinkedEvents] = useState<LinkedEvent[]>([]);
  const [rangePreset, setRangePreset] = useState<RangePreset>("7d");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedNetworks, setSelectedNetworks] = useState<NetworkKey[]>([]);
  const [attendanceTypeFilter, setAttendanceTypeFilter] = useState<AttendanceTypeFilter>("all");
  const [selectedLinkedEventId, setSelectedLinkedEventId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [eventLookup, setEventLookup] = useState<Record<string, EventLookup>>({});
  const [page, setPage] = useState(1);
  const [recordsView, setRecordsView] = useState<RecordsView>("attendance");
  const [lifegroups, setLifegroups] = useState<Lifegroup[]>([]);
  const [lifegroupMembers, setLifegroupMembers] = useState<LifegroupMemberRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [lifegroupActivities, setLifegroupActivities] = useState<LifegroupActivityRow[]>([]);
  const [lifegroupRsvps, setLifegroupRsvps] = useState<LifegroupRsvpRow[]>([]);
  const [lifegroupAttendance, setLifegroupAttendance] = useState<LifegroupAttendanceRow[]>([]);
  const [lifegroupReportRows, setLifegroupReportRows] = useState<LifegroupReportRow[]>([]);
  const [lifegroupReportNote, setLifegroupReportNote] = useState("");
  const [lifegroupLoading, setLifegroupLoading] = useState(false);
  const [lifegroupError, setLifegroupError] = useState("");
  const [selectedLifegroupId, setSelectedLifegroupId] = useState<string>("all");
  const [selectedLifegroupMemberId, setSelectedLifegroupMemberId] = useState<string>("all");
  const [lifegroupRangePreset, setLifegroupRangePreset] = useState<LifegroupRangePreset>("7d");
  const [lifegroupFromDate, setLifegroupFromDate] = useState("");
  const [lifegroupToDate, setLifegroupToDate] = useState("");
  const [comparisonPage, setComparisonPage] = useState(0);
  const [activityPage, setActivityPage] = useState(0);
  const [reportNotice, setReportNotice] = useState("");

  const range = useMemo(() => {
    const today = new Date();

    if (rangePreset === "today") {
      const day = toLocalDateInput(today);
      return { from: day < MIN_ANALYTICS_DATE ? MIN_ANALYTICS_DATE : day, to: day };
    }

    if (rangePreset === "7d") {
      const from = new Date(today);
      from.setDate(from.getDate() - 6);
      const nextFrom = toLocalDateInput(from);
      return { from: nextFrom < MIN_ANALYTICS_DATE ? MIN_ANALYTICS_DATE : nextFrom, to: toLocalDateInput(today) };
    }

    if (rangePreset === "30d") {
      const from = new Date(today);
      from.setDate(from.getDate() - 29);
      const nextFrom = toLocalDateInput(from);
      return { from: nextFrom < MIN_ANALYTICS_DATE ? MIN_ANALYTICS_DATE : nextFrom, to: toLocalDateInput(today) };
    }

    const fallback = toLocalDateInput(today);
    const rawFrom = fromDate || fallback;
    const rawTo = toDate || fallback;
    const clampedFrom = rawFrom < MIN_ANALYTICS_DATE ? MIN_ANALYTICS_DATE : rawFrom;
    const clampedTo = rawTo < MIN_ANALYTICS_DATE ? MIN_ANALYTICS_DATE : rawTo;

    return {
      from: clampedFrom,
      to: clampedTo
    };
  }, [fromDate, rangePreset, toDate]);

  const lifegroupRange = useMemo(() => {
    const today = new Date();
    const todayKey = toLocalDateInput(today);

    if (lifegroupRangePreset === "today") {
      return { from: todayKey, to: todayKey };
    }

    if (lifegroupRangePreset === "7d") {
      const from = new Date(today);
      from.setDate(from.getDate() - 6);
      const nextFrom = toLocalDateInput(from);
      return { from: nextFrom < MIN_ANALYTICS_DATE ? MIN_ANALYTICS_DATE : nextFrom, to: todayKey };
    }

    if (lifegroupRangePreset === "30d") {
      const from = new Date(today);
      from.setDate(from.getDate() - 29);
      const nextFrom = toLocalDateInput(from);
      return { from: nextFrom < MIN_ANALYTICS_DATE ? MIN_ANALYTICS_DATE : nextFrom, to: todayKey };
    }

    if (lifegroupRangePreset === "custom") {
      const rawFrom = lifegroupFromDate || MIN_ANALYTICS_DATE;
      const rawTo = lifegroupToDate || todayKey;
      return {
        from: rawFrom < MIN_ANALYTICS_DATE ? MIN_ANALYTICS_DATE : rawFrom,
        to: rawTo < MIN_ANALYTICS_DATE ? MIN_ANALYTICS_DATE : rawTo
      };
    }

    return { from: MIN_ANALYTICS_DATE, to: todayKey };
  }, [lifegroupFromDate, lifegroupRangePreset, lifegroupToDate]);

  const fetchLifegroupData = useCallback(async () => {
    if (!hasSupabaseEnv) {
      setLifegroupError(supabaseEnvIssue ?? "Missing Supabase env values. Update .env.local and restart dev server.");
      setLifegroupLoading(false);
      return;
    }

    setLifegroupLoading(true);
    setLifegroupError("");

    const [groupsResult, membersResult, profilesResult, activitiesResult, rsvpsResult, attendanceResult, reportResult] =
      await Promise.all([
        supabase.from("lifegroups").select("*").order("name", { ascending: true }),
        supabase.from("lifegroup_members").select("*"),
        supabase.from("profiles").select("id, first_name, last_name"),
        supabase.from("lifegroup_activities").select("*").order("starts_at", { ascending: true }),
        supabase.from("lifegroup_activity_rsvps").select("*"),
        supabase.from("lifegroup_attendance").select("*"),
        supabase.from("lifegroup_attendance_report").select("*").limit(5000)
      ]);

    const primaryErrors = [
      groupsResult.error,
      membersResult.error,
      profilesResult.error,
      activitiesResult.error,
      rsvpsResult.error,
      attendanceResult.error
    ].filter((item): item is NonNullable<typeof item> => Boolean(item));

    if (groupsResult.error) setLifegroups([]);
    else setLifegroups((groupsResult.data ?? []) as Lifegroup[]);

    if (membersResult.error) setLifegroupMembers([]);
    else setLifegroupMembers((membersResult.data ?? []) as LifegroupMemberRow[]);

    if (profilesResult.error) setProfiles([]);
    else setProfiles((profilesResult.data ?? []) as ProfileRow[]);

    if (activitiesResult.error) setLifegroupActivities([]);
    else setLifegroupActivities((activitiesResult.data ?? []) as LifegroupActivityRow[]);

    if (rsvpsResult.error) setLifegroupRsvps([]);
    else setLifegroupRsvps((rsvpsResult.data ?? []) as LifegroupRsvpRow[]);

    if (attendanceResult.error) setLifegroupAttendance([]);
    else setLifegroupAttendance((attendanceResult.data ?? []) as LifegroupAttendanceRow[]);

    if (reportResult.error) {
      setLifegroupReportRows([]);
      setLifegroupReportNote(
        `The attendance report view could not be loaded (${reportResult.error.message}). Base attendance records are still used.`
      );
    } else {
      setLifegroupReportRows((reportResult.data ?? []) as LifegroupReportRow[]);
      setLifegroupReportNote("");
    }

    setLifegroupError(
      primaryErrors.length
        ? Array.from(new Set(primaryErrors.map((item) => item.message))).join(" ")
        : ""
    );
    setLifegroupLoading(false);
  }, []);

  useEffect(() => {
    void fetchLifegroupData();
  }, [fetchLifegroupData]);

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
        .select("id, student_id, full_name, was_newcomer, attendance_context, attendance_group, service_type, event_id, attended_date, attended_at")
        .gte("attended_date", range.from)
        .lte("attended_date", range.to)
        .order("attended_at", { ascending: false });

      const { data, error: fetchError } = await query;

      const usersResult = await supabase.from("users").select("id, student_id, full_name, age, gender, newcomer, descriptor, created_at");
      if (!usersResult.error) {
        setUsers((usersResult.data ?? []) as UserFace[]);
      }

      const eventsResult = await supabase
        .from("events")
        .select("id, title, event_date, event_type")
        .order("event_date", { ascending: true });

      if (!eventsResult.error) {
        const eventRows = (eventsResult.data ?? []) as Array<{
          id: string;
          title: string;
          event_date: string | null;
          event_type: string | null;
        }>;
        const lookup: Record<string, EventLookup> = {};
        for (const event of eventRows) {
          lookup[event.id] = { title: event.title, eventType: event.event_type };
        }
        setLinkedEvents(eventRows.map(({ id, title, event_date }) => ({ id, title, event_date })));
        setEventLookup(lookup);
      } else if (isMissingEventTypeColumnError(eventsResult.error.message)) {
        const eventsFallback = await supabase
          .from("events")
          .select("id, title, event_date")
          .order("event_date", { ascending: true });

        if (!eventsFallback.error) {
          const eventRows = (eventsFallback.data ?? []) as LinkedEvent[];
          const lookup: Record<string, EventLookup> = {};
          for (const event of eventRows) {
            lookup[event.id] = { title: event.title, eventType: null };
          }
          setLinkedEvents(eventRows);
          setEventLookup(lookup);
        }
      } else {
        setLinkedEvents([]);
        setEventLookup({});
      }

      if (fetchError) {
        if (isMissingServiceTypeColumnError(fetchError.message)) {
          const fallbackQuery = supabase
            .from("attendance")
            .select("id, student_id, full_name, was_newcomer, attendance_context, attendance_group, event_id, attended_date, attended_at")
            .gte("attended_date", range.from)
            .lte("attended_date", range.to)
            .order("attended_at", { ascending: false });

          const { data: fallbackData, error: fallbackError } = await fallbackQuery;
          if (fallbackError) throw fallbackError;

          setLogs(
            ((fallbackData ?? []) as AttendanceLog[]).map((row) => ({
              ...row,
              service_type: normalizeServiceType(row.attendance_context, null, row.attendance_group)
            }))
          );
          return;
        }

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
              attendance_group: null,
              service_type: null,
              event_id: null
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

  const linkedEventLabelById = useMemo(() => {
    const titleCounts = new Map<string, number>();
    for (const event of linkedEvents) {
      titleCounts.set(event.title, (titleCounts.get(event.title) ?? 0) + 1);
    }

    return new Map(
      linkedEvents.map((event) => {
        const duplicateTitle = (titleCounts.get(event.title) ?? 0) > 1;
        const label = duplicateTitle
          ? `${event.title}${event.event_date ? ` (${event.event_date})` : ` (${event.id.slice(0, 8)})`}`
          : event.title;
        return [event.id, label];
      })
    );
  }, [linkedEvents]);

  const linkedEventOptions = useMemo(() => {
    const options = new Map<string, { id: string; label: string; date: string | null }>();

    for (const event of linkedEvents) {
      options.set(event.id, {
        id: event.id,
        label: linkedEventLabelById.get(event.id) ?? event.title,
        date: event.event_date
      });
    }

    // Keep event-linked attendance filterable even if the event row was removed.
    for (const log of logs) {
      if (!log.event_id || options.has(log.event_id)) continue;
      options.set(log.event_id, {
        id: log.event_id,
        label: `Deleted Event (${log.event_id.slice(0, 8)})`,
        date: null
      });
    }

    if (selectedLinkedEventId && !options.has(selectedLinkedEventId)) {
      options.set(selectedLinkedEventId, {
        id: selectedLinkedEventId,
        label: `Deleted Event (${selectedLinkedEventId.slice(0, 8)})`,
        date: null
      });
    }

    return Array.from(options.values()).sort((a, b) => {
      if (a.date && b.date) {
        const byDate = b.date.localeCompare(a.date);
        return byDate !== 0 ? byDate : a.label.localeCompare(b.label);
      }
      if (a.date) return -1;
      if (b.date) return 1;
      return a.label.localeCompare(b.label);
    });
  }, [linkedEvents, linkedEventLabelById, logs, selectedLinkedEventId]);

  const availableLinkedEventOptions = useMemo(() => {
    if (attendanceTypeFilter === "all") return linkedEventOptions;

    return linkedEventOptions.filter((event) => {
      const eventType = eventLookup[event.id]?.eventType;
      if (eventType) return normalizeAttendanceType(eventType, null) === attendanceTypeFilter;
      return logs.some(
        (log) =>
          log.event_id === event.id &&
          normalizeAttendanceType(log.attendance_context, log.attendance_group) === attendanceTypeFilter
      );
    });
  }, [attendanceTypeFilter, eventLookup, linkedEventOptions, logs]);

  useEffect(() => {
    if (selectedLinkedEventId && !availableLinkedEventOptions.some((event) => event.id === selectedLinkedEventId)) {
      setSelectedLinkedEventId(null);
    }
  }, [availableLinkedEventOptions, selectedLinkedEventId]);

  const selectedLinkedEventLabel = useMemo(() => {
    if (!selectedLinkedEventId) return null;
    return linkedEventLabelById.get(selectedLinkedEventId) ?? `Deleted Event (${selectedLinkedEventId.slice(0, 8)})`;
  }, [linkedEventLabelById, selectedLinkedEventId]);

  const selectedNetworkSet = useMemo(() => new Set(selectedNetworks), [selectedNetworks]);
  const normalizedSearch = useMemo(() => searchTerm.trim().toLowerCase(), [searchTerm]);

  const toggleNetwork = useCallback((key: NetworkKey) => {
    setSelectedNetworks((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
  }, []);

  const handleAttendanceTypeChange = useCallback((filter: AttendanceTypeFilter) => {
    setAttendanceTypeFilter(filter);
    setSelectedLinkedEventId(null);
  }, []);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const userNetwork = userNetworkMap.get(log.student_id);
      const matchesNetwork =
        selectedNetworkSet.size === 0 || (userNetwork ? selectedNetworkSet.has(userNetwork) : false);

      const matchesAttendanceType =
        attendanceTypeFilter === "all" ||
        normalizeAttendanceType(log.attendance_context, log.attendance_group) === attendanceTypeFilter;

      const matchesLinkedEvent =
        !selectedLinkedEventId ||
        log.event_id === selectedLinkedEventId;

      const matchesSearch =
        normalizedSearch.length === 0 ||
        log.full_name.toLowerCase().includes(normalizedSearch) ||
        log.student_id.toLowerCase().includes(normalizedSearch);

      return matchesNetwork && matchesAttendanceType && matchesLinkedEvent && matchesSearch;
    });
  }, [attendanceTypeFilter, logs, normalizedSearch, selectedLinkedEventId, selectedNetworkSet, userNetworkMap]);

  const hasNoRecordsForSelectedLinkedEvent =
    Boolean(selectedLinkedEventId) &&
    filteredLogs.length === 0;

  useEffect(() => {
    setPage(1);
  }, [attendanceTypeFilter, normalizedSearch, range.from, range.to, selectedLinkedEventId, selectedNetworkSet]);

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / RECORDS_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedLogs = filteredLogs.slice(
    (currentPage - 1) * RECORDS_PAGE_SIZE,
    currentPage * RECORDS_PAGE_SIZE
  );

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
    const counts: Record<AttendanceType | "Unknown", number> = {
      "Sunday Service": 0,
      "Prayer Meeting": 0,
      Rooftop: 0,
      "Women's Network": 0,
      "Men's Network": 0,
      Unknown: 0
    };

    for (const log of filteredLogs) {
      const type = normalizeAttendanceType(log.attendance_context, log.attendance_group);
      if (type) counts[type] += 1;
      else counts.Unknown += 1;
    }

    const colors: Record<AttendanceType | "Unknown", string> = {
      "Sunday Service": "#1d4ed8",
      "Prayer Meeting": "#f59e0b",
      Rooftop: "#8b5cf6",
      "Women's Network": "#ef4444",
      "Men's Network": "#10b981",
      Unknown: "#64748b"
    };

    return [...ATTENDANCE_TYPES, "Unknown" as const].map((label) => ({
      label,
      value: counts[label],
      color: colors[label]
    }));
  }, [filteredLogs]);

  const attendanceByLinkedEvent = useMemo(() => {
    const counts = new Map<string, number>();

    for (const log of filteredLogs) {
      if (!log.event_id) continue;
      counts.set(log.event_id, (counts.get(log.event_id) ?? 0) + 1);
    }

    return Array.from(counts.entries())
      .map(([eventId, value]) => ({
        label: linkedEventLabelById.get(eventId) ?? `Deleted Event (${eventId.slice(0, 8)})`,
        value
      }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
      .map((item, index) => ({
        ...item,
        color: LINKED_EVENT_COLORS[index % LINKED_EVENT_COLORS.length]
      }));
  }, [filteredLogs, linkedEventLabelById]);

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

  const lifegroupAnalytics = useMemo(() => {
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const groupById = new Map(lifegroups.map((group) => [group.id, group]));
    const activityById = new Map(lifegroupActivities.map((activity) => [activity.id, activity]));

    const membershipsByGroup = new Map<string, LifegroupMemberRow[]>();
    const seenMemberships = new Set<string>();
    for (const row of lifegroupMembers) {
      const key = `${row.lifegroup_id}|${row.user_id}`;
      if (seenMemberships.has(key)) continue;
      seenMemberships.add(key);
      const current = membershipsByGroup.get(row.lifegroup_id) ?? [];
      current.push(row);
      membershipsByGroup.set(row.lifegroup_id, current);
    }

    const scopedGroups =
      selectedLifegroupId === "all"
        ? lifegroups
        : lifegroups.filter((group) => group.id === selectedLifegroupId);

    const memberIds = new Set<string>();
    const activeMemberIds = new Set<string>();
    let membershipCount = 0;
    for (const group of scopedGroups) {
      const rows = membershipsByGroup.get(group.id) ?? [];
      membershipCount += rows.length;
      for (const row of rows) {
        memberIds.add(row.user_id);
        if (isActiveMembership(row)) activeMemberIds.add(row.user_id);
      }
    }
    const inactiveMemberIds = new Set(Array.from(memberIds).filter((id) => !activeMemberIds.has(id)));

    const activitiesInRange = lifegroupActivities.filter((activity) => {
      if (selectedLifegroupId !== "all" && activity.lifegroup_id !== selectedLifegroupId) return false;
      const date = activityDate(activity);
      return dateInRange(date, lifegroupRange.from, lifegroupRange.to);
    });
    const activityIdsInRange = new Set(activitiesInRange.map((activity) => activity.id));

    const rsvpByKey = new Map<string, LifegroupRsvpRow>();
    for (const row of lifegroupRsvps) {
      if (!activityIdsInRange.has(row.activity_id)) continue;
      if (selectedLifegroupMemberId !== "all" && row.user_id !== selectedLifegroupMemberId) continue;
      const key = `${row.activity_id}|${row.user_id}`;
      const existing = rsvpByKey.get(key);
      const rowTime = row.updated_at ?? row.created_at ?? "";
      const existingTime = existing?.updated_at ?? existing?.created_at ?? "";
      if (!existing || rowTime >= existingTime) rsvpByKey.set(key, row);
    }
    const rsvpRows = Array.from(rsvpByKey.values());
    const rsvpCounts = { yes: 0, no: 0, maybe: 0, other: 0 };
    for (const row of rsvpRows) rsvpCounts[normalizeRsvpResponse(row.response ?? null)] += 1;

    type ProcessedAttendance = {
      lifegroupId: string;
      activityId: string | null;
      date: string | null;
      present: boolean;
      userId: string;
    };

    const attendanceByKey = new Map<string, ProcessedAttendance>();
    for (const row of lifegroupAttendance) {
      const activity = row.activity_id ? activityById.get(row.activity_id) : undefined;
      const lifegroupId = row.lifegroup_id ?? activity?.lifegroup_id ?? null;
      if (!lifegroupId) continue;
      if (selectedLifegroupId !== "all" && lifegroupId !== selectedLifegroupId) continue;
      if (selectedLifegroupMemberId !== "all" && row.user_id !== selectedLifegroupMemberId) continue;

      const date = attendanceDate(row, activityById);
      if (!dateInRange(date, lifegroupRange.from, lifegroupRange.to)) continue;

      const key = row.activity_id
        ? `${row.activity_id}|${row.user_id}`
        : `${lifegroupId}|${row.user_id}|${date ?? row.id ?? "unknown"}`;
      const present = isPresentAttendance(row);
      const existing = attendanceByKey.get(key);

      if (!existing) {
        attendanceByKey.set(key, {
          lifegroupId,
          activityId: row.activity_id ?? null,
          date,
          present,
          userId: row.user_id
        });
      } else if (present && !existing.present) {
        attendanceByKey.set(key, { ...existing, present: true });
      }
    }

    const attendanceRows = Array.from(attendanceByKey.values());
    const presentRows = attendanceRows.filter((row) => row.present);
    const absentRows = attendanceRows.filter((row) => !row.present);
    const uniqueAttendeeIds = new Set(presentRows.map((row) => row.userId));

    const daily = new Map<string, number>();
    for (const row of presentRows) {
      if (!row.date) continue;
      daily.set(row.date, (daily.get(row.date) ?? 0) + 1);
    }
    const trend = Array.from(daily.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14)
      .map(([date, value]) => ({ label: formatDateMMDDYY(date), value }));

    const activityStatusCounts = { scheduled: 0, completed: 0, cancelled: 0, other: 0 };
    for (const activity of activitiesInRange) {
      const status = (activity.status ?? "").trim().toLowerCase();
      if (status === "scheduled") activityStatusCounts.scheduled += 1;
      else if (status === "completed" || status === "complete") activityStatusCounts.completed += 1;
      else if (status === "cancelled" || status === "canceled") activityStatusCounts.cancelled += 1;
      else activityStatusCounts.other += 1;
    }

    // The reporting view is optional: when it exposes activity/group totals,
    // use those numbers for the report tables; otherwise fall back to the
    // deduplicated base attendance records.
    const reportAttendanceByActivity = new Map<string, number>();
    const reportAttendanceByGroup = new Map<string, number>();
    for (const row of lifegroupReportRows) {
      const activityId = rowString(row, ["activity_id", "lifegroup_activity_id"]);
      const groupId = rowString(row, ["lifegroup_id", "group_id"]);
      const value = rowNumber(row, [
        "present_count",
        "attended_count",
        "attendance_count",
        "total_present",
        "present",
        "total_attendance",
        "count"
      ]);
      if (value === null) continue;
      if (activityId) {
        reportAttendanceByActivity.set(activityId, (reportAttendanceByActivity.get(activityId) ?? 0) + value);
      }
      if (groupId) {
        reportAttendanceByGroup.set(groupId, (reportAttendanceByGroup.get(groupId) ?? 0) + value);
      }
    }

    const colorKeys = Object.keys(GROUP_COLORS) as Array<keyof typeof GROUP_COLORS>;
    const perGroup = scopedGroups.map((group, index) => {
      const groupMembers = membershipsByGroup.get(group.id) ?? [];
      const groupMemberIds = new Set(groupMembers.map((row) => row.user_id));
      const groupActiveIds = new Set(groupMembers.filter(isActiveMembership).map((row) => row.user_id));
      const groupActivities = activitiesInRange.filter((activity) => activity.lifegroup_id === group.id);
      const groupActivityIds = new Set(groupActivities.map((activity) => activity.id));
      const groupPresent = presentRows.filter((row) => row.lifegroupId === group.id);
      const groupAbsent = absentRows.filter((row) => row.lifegroupId === group.id);
      const groupRsvps = rsvpRows.filter((row) => groupActivityIds.has(row.activity_id));
      const groupUniqueAttendees = new Set(groupPresent.map((row) => row.userId));
      const baseAttendance = groupPresent.length;

      return {
        id: group.id,
        name: group.name,
        status: group.status ?? "active",
        leaderName: group.leader_id
          ? displayProfileName(profileById.get(group.leader_id))
          : "Unassigned",
        members: groupMemberIds.size,
        activeMembers: groupActiveIds.size,
        activities: groupActivities.length,
        attendance: baseAttendance,
        reportAttendance: reportAttendanceByGroup.get(group.id) ?? null,
        absent: groupAbsent.length,
        uniqueAttendees: groupUniqueAttendees.size,
        rsvps: groupRsvps.length,
        yes: groupRsvps.filter((row) => normalizeRsvpResponse(row.response ?? null) === "yes").length,
        no: groupRsvps.filter((row) => normalizeRsvpResponse(row.response ?? null) === "no").length,
        maybe: groupRsvps.filter((row) => normalizeRsvpResponse(row.response ?? null) === "maybe").length,
        avgAttendancePerActivity: groupActivities.length ? baseAttendance / groupActivities.length : 0,
        color: GROUP_COLORS[colorKeys[index % colorKeys.length]] ?? "#0f766e"
      };
    });

    const attendanceByGroup = perGroup.map((group) => ({
      label: group.name,
      value: group.attendance,
      color: group.color
    }));
    const membersByGroup = perGroup.map((group) => ({
      label: group.name,
      value: group.members,
      color: group.color
    }));
    const rsvpBreakdown = [
      { label: "Yes", value: rsvpCounts.yes, color: "#0f766e" },
      { label: "No", value: rsvpCounts.no, color: "#e11d48" },
      { label: "Maybe", value: rsvpCounts.maybe, color: "#f59e0b" },
      { label: "Other", value: rsvpCounts.other, color: "#64748b" }
    ];

    const members = (selectedLifegroupId === "all" ? [] : membershipsByGroup.get(selectedLifegroupId) ?? [])
      .map((row) => {
        return {
          user_id: row.user_id,
          name: displayProfileName(profileById.get(row.user_id)),
          status: row.status ?? "unknown",
          role: row.role ?? "member"
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const recentActivities = activitiesInRange
      .map((activity) => {
        const group = groupById.get(activity.lifegroup_id);
        const activityAttendance = presentRows.filter((row) => row.activityId === activity.id);
        const baseCount = activityAttendance.length;
        const reportCount = reportAttendanceByActivity.get(activity.id);
        const activityRsvps = rsvpRows.filter((row) => row.activity_id === activity.id);
        return {
          id: activity.id,
          title: activity.title?.trim() || "Untitled activity",
          groupName: group?.name ?? "Unknown lifegroup",
          date: activityDate(activity),
          status: activity.status ?? "unknown",
          attendance: reportCount ?? baseCount,
          uniqueAttendees: new Set(activityAttendance.map((row) => row.userId)).size,
          rsvps: activityRsvps.length,
          yes: activityRsvps.filter((row) => normalizeRsvpResponse(row.response ?? null) === "yes").length,
          no: activityRsvps.filter((row) => normalizeRsvpResponse(row.response ?? null) === "no").length,
          maybe: activityRsvps.filter((row) => normalizeRsvpResponse(row.response ?? null) === "maybe").length
        };
      })
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.title.localeCompare(b.title));

    return {
      scopedGroups,
      totalGroups: scopedGroups.length,
      totalMembers: memberIds.size,
      activeMembers: activeMemberIds.size,
      inactiveMembers: inactiveMemberIds.size,
      membershipCount,
      activities: activitiesInRange.length,
      activityStatusCounts,
      attendanceCount: presentRows.length,
      absentCount: absentRows.length,
      uniqueAttendees: uniqueAttendeeIds.size,
      rsvpCount: rsvpRows.length,
      rsvpCounts,
      trend,
      attendanceByGroup,
      membersByGroup,
      rsvpBreakdown,
      perGroup,
      members,
      recentActivities,
      reportAttendanceAvailable: reportAttendanceByActivity.size > 0 || reportAttendanceByGroup.size > 0
    };
  }, [
    formatDateMMDDYY,
    lifegroupActivities,
    lifegroupAttendance,
    lifegroupMembers,
    lifegroupRange.from,
    lifegroupRange.to,
    lifegroupReportRows,
    lifegroupRsvps,
    lifegroups,
    selectedLifegroupId,
    selectedLifegroupMemberId,
    profiles
  ]);

  const selectedLifegroupName = useMemo(
    () => lifegroups.find((group) => group.id === selectedLifegroupId)?.name ?? "",
    [lifegroups, selectedLifegroupId]
  );
  const comparisonPageCount = Math.ceil(lifegroupAnalytics.perGroup.length / LIFEGROUP_PANEL_PAGE_SIZE);
  const activityPageCount = Math.ceil(lifegroupAnalytics.recentActivities.length / LIFEGROUP_PANEL_PAGE_SIZE);
  const safeComparisonPage = Math.min(comparisonPage, Math.max(comparisonPageCount - 1, 0));
  const safeActivityPage = Math.min(activityPage, Math.max(activityPageCount - 1, 0));
  const visibleComparisonGroups = lifegroupAnalytics.perGroup.slice(
    safeComparisonPage * LIFEGROUP_PANEL_PAGE_SIZE,
    (safeComparisonPage + 1) * LIFEGROUP_PANEL_PAGE_SIZE
  );
  const visibleRecentActivities = lifegroupAnalytics.recentActivities.slice(
    safeActivityPage * LIFEGROUP_PANEL_PAGE_SIZE,
    (safeActivityPage + 1) * LIFEGROUP_PANEL_PAGE_SIZE
  );

  const RANGE_PRESET_LABELS: Record<RangePreset, string> = {
    today: "Today",
    "7d": "Last 7 days",
    "30d": "Last 30 days",
    custom: "Custom range"
  };

  const toDistributionTable = (
    title: string,
    items: Array<{ label: string; value: number }>
  ): ReportTable => {
    const total = items.reduce((sum, item) => sum + item.value, 0);
    return {
      title,
      columns: ["Category", "Count", "Share"],
      rows: items.map((item) => [
        item.label,
        item.value,
        total > 0 ? Math.round((item.value / total) * 1000) / 10 : 0
      ]),
      rightAlignFrom: 1,
      barColumn: 2
    };
  };

  const printAttendanceReport = () => {
    const ministryLabel =
      selectedNetworks.length === 0
        ? "All ministries"
        : selectedNetworks.map((network) => NETWORK_LABELS[network]).join(", ");
    const opened = openReportWindow({
      title: "Attendance Records Report",
      orientation: "landscape",
      metaRows: [
        `Date range: ${formatDateMMDDYY(range.from)} – ${formatDateMMDDYY(range.to)} (${RANGE_PRESET_LABELS[rangePreset]})`,
        `Ministries: ${ministryLabel}`,
        `Attendance type: ${attendanceTypeFilter === "all" ? "All" : attendanceTypeFilter}`,
        `Linked event: ${selectedLinkedEventLabel ?? "All"}`,
        ...(searchTerm.trim() ? [`Search: "${searchTerm.trim()}"`] : [])
      ],
      stats: [
        { label: "Attendees", value: filteredLogs.length },
        { label: "Newcomers", value: newcomerAttendeeCount },
        { label: "Returning Attendees", value: returningAttendeeCount },
        { label: "Newcomer Visits", value: newcomerCheckInCount }
      ],
      sections: [
        {
          title: `Attendance Records (${filteredLogs.length})`,
          tables: [
            {
              title: "All filtered records",
              columns: [
                "Member Name",
                "Member ID",
                "Attendance Type",
                "Service Session",
                "Event Name",
                "Event Type",
                "Date",
                "Time"
              ],
              rightAlignFrom: 7,
              rows: filteredLogs.map((log) => {
                const attendanceType = normalizeAttendanceType(log.attendance_context, log.attendance_group);
                const linkedEvent = log.event_id ? eventLookup[log.event_id] : null;
                return [
                  log.full_name,
                  log.student_id,
                  attendanceType ?? "Unknown",
                  serviceSessionForLog(log),
                  linkedEvent?.title ?? "N/A",
                  linkedEvent?.eventType ?? "N/A",
                  formatDateMMDDYY(log.attended_date),
                  new Date(log.attended_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                ];
              })
            }
          ]
        },
        {
          title: "Analytics",
          tables: [
            toDistributionTable("Attendees by Day (Last 10)", dailyTotals),
            toDistributionTable("Attendees by Ministry", recordsByGroup),
            toDistributionTable("Newcomer Visits by Ministry", newcomerByGroup),
            toDistributionTable("Attendees by Attendance Type", attendanceByContext),
            toDistributionTable("Attendees by Linked Event", attendanceByLinkedEvent),
            toDistributionTable("Attendees by Service or Event", attendanceByGroup),
            toDistributionTable("Newcomers by Ministry", demographicAnalytics.newcomersByNetwork),
            toDistributionTable("Attendee Age Distribution", demographicAnalytics.ageDistribution),
            toDistributionTable("Attendee Gender Distribution", demographicAnalytics.genderDistribution)
          ]
        }
      ]
    });
    setReportNotice(opened ? "" : "Allow pop-ups for this site to open the printable report.");
  };

  const exportAttendanceCsv = () => {
    const csv = toCsv(
      [
        "Member Name",
        "Member ID",
        "Attendance Type",
        "Service Session",
        "Event Name",
        "Event Type",
        "Date",
        "Time"
      ],
      filteredLogs.map((log) => {
        const attendanceType = normalizeAttendanceType(log.attendance_context, log.attendance_group);
        const linkedEvent = log.event_id ? eventLookup[log.event_id] : null;
        return [
          log.full_name,
          log.student_id,
          attendanceType ?? "Unknown",
          serviceSessionForLog(log),
          linkedEvent?.title ?? "N/A",
          linkedEvent?.eventType ?? "N/A",
          log.attended_date,
          new Date(log.attended_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        ];
      })
    );
    downloadCsv(`attendance-records_${range.from}_to_${range.to}.csv`, csv);
    setReportNotice("");
  };

  const printLifegroupReport = () => {
    const memberName =
      selectedLifegroupMemberId === "all"
        ? "All members"
        : lifegroupAnalytics.members.find((member) => member.user_id === selectedLifegroupMemberId)?.name ??
          "Selected member";
    const statusItems = [
      { label: "Scheduled", value: lifegroupAnalytics.activityStatusCounts.scheduled },
      { label: "Completed", value: lifegroupAnalytics.activityStatusCounts.completed },
      { label: "Cancelled", value: lifegroupAnalytics.activityStatusCounts.cancelled },
      { label: "Other", value: lifegroupAnalytics.activityStatusCounts.other }
    ];
    const opened = openReportWindow({
      title: "Lifegroup Analytics Report",
      orientation: "portrait",
      metaRows: [
        `Date range: ${lifegroupRange.from} to ${lifegroupRange.to} (${RANGE_PRESET_LABELS[lifegroupRangePreset]})`,
        `Lifegroup: ${selectedLifegroupName || "All lifegroups"}`,
        `Member: ${memberName}`,
        ...(lifegroupReportNote ? [lifegroupReportNote] : [])
      ],
      stats: [
        { label: "Lifegroups", value: lifegroupAnalytics.totalGroups },
        { label: "Members", value: lifegroupAnalytics.totalMembers },
        { label: "Active Members", value: lifegroupAnalytics.activeMembers },
        { label: "Inactive / Pending", value: lifegroupAnalytics.inactiveMembers },
        { label: "Activities", value: lifegroupAnalytics.activities },
        { label: "Attendance", value: lifegroupAnalytics.attendanceCount },
        { label: "Absent", value: lifegroupAnalytics.absentCount },
        { label: "Unique Attendees", value: lifegroupAnalytics.uniqueAttendees },
        { label: "RSVPs", value: lifegroupAnalytics.rsvpCount }
      ],
      sections: [
        {
          title: "Breakdowns",
          tables: [
            toDistributionTable("Activity Status", statusItems),
            toDistributionTable("RSVP Responses", lifegroupAnalytics.rsvpBreakdown)
          ]
        },
        {
          title: "Lifegroup Comparison",
          tables: [
            {
              title: "All lifegroups in range",
              columns: [
                "Lifegroup",
                "Leader",
                "Members",
                "Active",
                "Activities",
                "Attendance",
                "Absent",
                "Unique Attendees",
                "RSVPs",
                "Avg / Activity"
              ],
              rightAlignFrom: 2,
              rows: lifegroupAnalytics.perGroup.map((group) => [
                group.name,
                group.leaderName,
                group.members,
                group.activeMembers,
                group.activities,
                group.attendance,
                group.absent,
                group.uniqueAttendees,
                group.rsvps,
                group.avgAttendancePerActivity.toFixed(1)
              ])
            }
          ]
        },
        ...(selectedLifegroupId !== "all"
          ? [
              {
                title: `Members of ${selectedLifegroupName}`,
                tables: [
                  {
                    title: "Membership",
                    columns: ["Member", "Role", "Membership Status"],
                    rows: lifegroupAnalytics.members.map((member) => [
                      member.name,
                      member.role,
                      member.status
                    ])
                  }
                ]
              }
            ]
          : []),
        {
          title: `Activities (${lifegroupAnalytics.recentActivities.length})`,
          tables: [
            {
              title: "All activities in range",
              columns: ["Activity", "Lifegroup", "Date", "Status", "Attendance", "RSVPs (Y / N / M)"],
              rightAlignFrom: 4,
              rows: lifegroupAnalytics.recentActivities.map((activity) => [
                activity.title,
                activity.groupName,
                activity.date ?? "—",
                activity.status,
                activity.attendance,
                `${activity.yes} / ${activity.no} / ${activity.maybe}`
              ])
            }
          ]
        }
      ]
    });
    setReportNotice(opened ? "" : "Allow pop-ups for this site to open the printable report.");
  };

  const exportLifegroupCsv = () => {
    const csv = toCsv(
      [
        "Activity",
        "Lifegroup",
        "Date",
        "Status",
        "Attendance",
        "Unique Attendees",
        "RSVP Yes",
        "RSVP No",
        "RSVP Maybe"
      ],
      lifegroupAnalytics.recentActivities.map((activity) => [
        activity.title,
        activity.groupName,
        activity.date ?? "",
        activity.status,
        activity.attendance,
        activity.uniqueAttendees,
        activity.yes,
        activity.no,
        activity.maybe
      ])
    );
    downloadCsv(`lifegroup-activities_${lifegroupRange.from}_to_${lifegroupRange.to}.csv`, csv);
    setReportNotice("");
  };

  return (
    <div className="space-y-6 reveal">
      <section>
        <h1 className="page-title font-[var(--font-heading)]">Records Analytics</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className={recordsView === "attendance" ? "btn-primary" : "btn-ghost"}
            onClick={() => setRecordsView("attendance")}
          >
            Attendance Records
          </button>
          <button
            type="button"
            className={recordsView === "lifegroups" ? "btn-primary" : "btn-ghost"}
            onClick={() => setRecordsView("lifegroups")}
          >
            Lifegroup Analytics
          </button>
        </div>
      </section>

      {recordsView === "lifegroups" ? (
        <section className="space-y-4">
          {lifegroupError ? <div className="status-error">{lifegroupError}</div> : null}
          {lifegroupLoading ? <div className="status-info">Loading lifegroup analytics...</div> : null}
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <article className="analytics-card">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Lifegroups</p>
              <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">{lifegroupAnalytics.totalGroups}</p>
            </article>
            <article className="analytics-card">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Members</p>
              <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">{lifegroupAnalytics.totalMembers}</p>
            </article>
            <article className="analytics-card">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Active Members</p>
              <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">{lifegroupAnalytics.activeMembers}</p>
            </article>
            <article className="analytics-card">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Inactive / Pending</p>
              <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">{lifegroupAnalytics.inactiveMembers}</p>
            </article>
            <article className="analytics-card">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Attendance Records</p>
              <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">{lifegroupAnalytics.attendanceCount}</p>
            </article>
            <article className="analytics-card">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Activities</p>
              <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">{lifegroupAnalytics.activities}</p>
            </article>
          </section>

          <section className="card grid gap-4 lg:grid-cols-3">
            <div>
              <label className="field-label" htmlFor="lifegroup-filter">Filter by Lifegroup</label>
              <select
                id="lifegroup-filter"
                className="field-input"
                value={selectedLifegroupId}
                onChange={(event) => {
                  setSelectedLifegroupId(event.target.value);
                  setSelectedLifegroupMemberId("all");
                }}
              >
                {lifegroups.map((lifegroup) => (
                  <option key={lifegroup.id} value={lifegroup.id}>{lifegroup.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="lifegroup-member-filter">Track Member Activity</label>
              <select
                id="lifegroup-member-filter"
                className="field-input"
                value={selectedLifegroupMemberId}
                onChange={(event) => setSelectedLifegroupMemberId(event.target.value)}
                disabled={selectedLifegroupId === "all"}
              >
                <option value="all">All Members</option>
                {lifegroupAnalytics.members.map((member) => (
                  <option key={member.user_id} value={member.user_id}>{member.name}</option>
                ))}
              </select>
            </div>
            <div>
              <p className="field-label">Date Range</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setLifegroupRangePreset("today")}
                  className={lifegroupRangePreset === "today" ? "btn-primary" : "btn-ghost"}
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => setLifegroupRangePreset("7d")}
                  className={lifegroupRangePreset === "7d" ? "btn-primary" : "btn-ghost"}
                >
                  7 Days
                </button>
                <button
                  type="button"
                  onClick={() => setLifegroupRangePreset("30d")}
                  className={lifegroupRangePreset === "30d" ? "btn-primary" : "btn-ghost"}
                >
                  30 Days
                </button>
                <button
                  type="button"
                  onClick={() => setLifegroupRangePreset("custom")}
                  className={lifegroupRangePreset === "custom" ? "btn-primary" : "btn-ghost"}
                >
                  Custom
                </button>
              </div>
              {lifegroupRangePreset === "custom" ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    type="date"
                    min={MIN_ANALYTICS_DATE}
                    value={lifegroupFromDate}
                    onChange={(event) => setLifegroupFromDate(event.target.value)}
                    className="field-input max-w-[170px]"
                    aria-label="Lifegroup start date"
                  />
                  <input
                    type="date"
                    min={MIN_ANALYTICS_DATE}
                    value={lifegroupToDate}
                    onChange={(event) => setLifegroupToDate(event.target.value)}
                    className="field-input max-w-[170px]"
                    aria-label="Lifegroup end date"
                  />
                </div>
              ) : null}
              <p className="mt-2 text-xs text-[#71847c]">
                {`${lifegroupRange.from} to ${lifegroupRange.to}`}
              </p>
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" onClick={() => void fetchLifegroupData()} className="btn-primary w-fit" disabled={lifegroupLoading}>
              {lifegroupLoading ? "Refreshing..." : "Refresh Lifegroup Data"}
            </button>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={exportLifegroupCsv} className="btn-ghost w-fit">
                Export CSV
              </button>
              <button type="button" onClick={printLifegroupReport} className="btn-ghost w-fit">
                Print/Save PDF
              </button>
            </div>
          </div>
          {reportNotice ? <div className="status-info">{reportNotice}</div> : null}

          <section className="analytics-panel">
            <h2 className="font-[var(--font-heading)] text-lg text-[#23332d]">Lifegroup Attendance & Activity</h2>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <LineChart
                title="Attendance by Lifegroup"
                items={lifegroupAnalytics.attendanceByGroup}
                emptyText="No lifegroup attendance records in this range."
              />
              <LineChart
                title="Members by Lifegroup"
                items={lifegroupAnalytics.membersByGroup}
                emptyText="No lifegroup memberships found."
              />
              <LineChart
                title="Attendance Over Time"
                items={lifegroupAnalytics.trend}
                emptyText="No lifegroup attendance in this range."
                emptyHint="Attendance is taken from lifegroup_attendance, not from membership or RSVP records."
              />
            </div>
          </section>

          <section className="analytics-panel">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h2 className="font-[var(--font-heading)] text-lg text-[#23332d]">Lifegroup Comparison</h2>
              {lifegroupAnalytics.reportAttendanceAvailable ? (
                <p className="text-xs text-[#71847c]">Per-activity attendance uses lifegroup_attendance_report where available.</p>
              ) : null}
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[#d6e1dd] text-[10px] uppercase tracking-[0.08em] text-[#71847c]">
                    <th className="px-2 py-2">Lifegroup</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Leader</th>
                    <th className="px-2 py-2 text-right">Members</th>
                    <th className="px-2 py-2 text-right">Active</th>
                    <th className="px-2 py-2 text-right">Activities</th>
                    <th className="px-2 py-2 text-right">Attendance</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleComparisonGroups.map((group) => (
                    <tr key={group.id} className="border-b border-[#edf2ef] last:border-0">
                      <td className="px-2 py-3 font-semibold text-[#2f4d43]">{group.name}</td>
                      <td className="px-2 py-3 capitalize text-[#5e766c]">{group.status}</td>
                      <td className="px-2 py-3 text-[#5e766c]">{group.leaderName}</td>
                      <td className="px-2 py-3 text-right text-[#315349]">{group.members}</td>
                      <td className="px-2 py-3 text-right text-[#315349]">{group.activeMembers}</td>
                      <td className="px-2 py-3 text-right text-[#315349]">{group.activities}</td>
                      <td className="px-2 py-3 text-right text-[#315349]">{group.attendance}</td>
                    </tr>
                  ))}
                  {!lifegroupAnalytics.perGroup.length ? (
                    <tr>
                      <td colSpan={6} className="px-2 py-6 text-center text-sm text-[#71847c]">
                        No lifegroups found. Check that lifegroups are available to your account.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {comparisonPageCount > 1 ? (
              <div className="mt-4 flex items-center justify-between gap-3">
                <button
                  type="button"
                  className="btn-ghost px-3 py-1.5 text-xs"
                  onClick={() => setComparisonPage(Math.max(0, safeComparisonPage - 1))}
                  disabled={safeComparisonPage === 0}
                >
                  Previous
                </button>
                <span className="text-xs text-[#71847c]">Page {safeComparisonPage + 1} of {comparisonPageCount}</span>
                <button
                  type="button"
                  className="btn-ghost px-3 py-1.5 text-xs"
                  onClick={() => setComparisonPage(Math.min(comparisonPageCount - 1, safeComparisonPage + 1))}
                  disabled={safeComparisonPage === comparisonPageCount - 1}
                >
                  Next
                </button>
              </div>
            ) : null}
          </section>

          {selectedLifegroupId !== "all" ? (
            <section className="analytics-panel">
              <h2 className="font-[var(--font-heading)] text-lg text-[#23332d]">Members of {selectedLifegroupName}</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#d6e1dd] text-[10px] uppercase tracking-[0.08em] text-[#71847c]">
                      <th className="px-2 py-2">Member</th>
                      <th className="px-2 py-2">Role</th>
                      <th className="px-2 py-2">Membership Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lifegroupAnalytics.members.map((member) => (
                      <tr key={member.user_id} className="border-b border-[#edf2ef] last:border-0">
                        <td className="px-2 py-3 font-semibold text-[#2f4d43]">{member.name}</td>
                        <td className="px-2 py-3 capitalize text-[#5e766c]">{member.role}</td>
                        <td className="px-2 py-3 capitalize text-[#5e766c]">{member.status}</td>
                      </tr>
                    ))}
                    {!lifegroupAnalytics.members.length ? (
                      <tr>
                        <td colSpan={3} className="px-2 py-6 text-center text-sm text-[#71847c]">
                          No membership records for this lifegroup.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className="analytics-panel">
            <h2 className="font-[var(--font-heading)] text-lg text-[#23332d]">Recent Activities</h2>
            {lifegroupReportNote ? <p className="mt-2 text-xs text-[#8a6d3b]">{lifegroupReportNote}</p> : null}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[#d6e1dd] text-[10px] uppercase tracking-[0.08em] text-[#71847c]">
                    <th className="px-2 py-2">Activity</th>
                    <th className="px-2 py-2">Lifegroup</th>
                    <th className="px-2 py-2">Date</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2 text-right">Attendance</th>
                    <th className="px-2 py-2 text-right">RSVPs (Y / N / M)</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRecentActivities.map((activity) => (
                    <tr key={activity.id} className="border-b border-[#edf2ef] last:border-0">
                      <td className="px-2 py-3 font-semibold text-[#2f4d43]">{activity.title}</td>
                      <td className="px-2 py-3 text-[#5e766c]">{activity.groupName}</td>
                      <td className="px-2 py-3 text-[#5e766c]">{activity.date ?? "—"}</td>
                      <td className="px-2 py-3 capitalize text-[#5e766c]">{activity.status}</td>
                      <td className="px-2 py-3 text-right text-[#315349]">{activity.attendance}</td>
                      <td className="px-2 py-3 text-right text-[#315349]">
                        {activity.yes} / {activity.no} / {activity.maybe}
                      </td>
                    </tr>
                  ))}
                  {!lifegroupAnalytics.recentActivities.length ? (
                    <tr>
                      <td colSpan={7} className="px-2 py-6 text-center text-sm text-[#71847c]">
                        No lifegroup activities in this date range.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {activityPageCount > 1 ? (
              <div className="mt-4 flex items-center justify-between gap-3">
                <button
                  type="button"
                  className="btn-ghost px-3 py-1.5 text-xs"
                  onClick={() => setActivityPage(Math.max(0, safeActivityPage - 1))}
                  disabled={safeActivityPage === 0}
                >
                  Previous
                </button>
                <span className="text-xs text-[#71847c]">Page {safeActivityPage + 1} of {activityPageCount}</span>
                <button
                  type="button"
                  className="btn-ghost px-3 py-1.5 text-xs"
                  onClick={() => setActivityPage(Math.min(activityPageCount - 1, safeActivityPage + 1))}
                  disabled={safeActivityPage === activityPageCount - 1}
                >
                  Next
                </button>
              </div>
            ) : null}
          </section>
        </section>
      ) : null}

      <div className={recordsView === "attendance" ? "space-y-6" : "hidden"}>
      <section className="analytics-strip" data-tour="records-overview">
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
          <button type="button" onClick={() => setRangePreset("7d")} className={rangePreset === "7d" ? "btn-primary" : "btn-ghost"}>7 Days</button>
          <button type="button" onClick={() => setRangePreset("30d")} className={rangePreset === "30d" ? "btn-primary" : "btn-ghost"}>30 Days</button>
          <button type="button" onClick={() => setRangePreset("custom")} className={rangePreset === "custom" ? "btn-primary" : "btn-ghost"}>Custom</button>
          {rangePreset === "custom" ? (
            <>
              <input type="date" min={MIN_ANALYTICS_DATE} value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="field-input max-w-[170px]" />
              <input type="date" min={MIN_ANALYTICS_DATE} value={toDate} onChange={(e) => setToDate(e.target.value)} className="field-input max-w-[170px]" />
            </>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void fetchLogs()} className="btn-primary w-fit">
            Refresh
          </button>
          <button type="button" onClick={exportAttendanceCsv} className="btn-ghost w-fit">
            Export CSV
          </button>
          <button type="button" onClick={printAttendanceReport} className="btn-ghost w-fit">
            Print / Save PDF
          </button>
        </div>
        {reportNotice ? <div className="status-info">{reportNotice}</div> : null}
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

        <p className="field-label">Filter by Attendance Type</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handleAttendanceTypeChange("all")}
            className={attendanceTypeFilter === "all" ? "btn-primary" : "btn-ghost"}
          >
            All Attendance Types
          </button>
          {ATTENDANCE_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => handleAttendanceTypeChange(type)}
              className={attendanceTypeFilter === type ? "btn-primary" : "btn-ghost"}
            >
              {type}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
            <div className="w-full sm:max-w-sm">
              <label className="field-label" htmlFor="linked-event-filter">
                Filter By Linked Event
              </label>
              <select
                id="linked-event-filter"
                className="field-input"
                value={selectedLinkedEventId ?? ""}
                onChange={(event) => setSelectedLinkedEventId(event.target.value || null)}
                disabled={availableLinkedEventOptions.length === 0}
              >
                <option value="">All Linked Events</option>
                {availableLinkedEventOptions.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.label}
                  </option>
                ))}
              </select>
            </div>
            {selectedLinkedEventId ? (
              <button type="button" onClick={() => setSelectedLinkedEventId(null)} className="btn-ghost">
                Clear Event
              </button>
            ) : null}
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
      {!loading && !error && hasNoRecordsForSelectedLinkedEvent ? (
        <div className="status-info">
          No attendance records for {selectedLinkedEventLabel ?? "the selected linked event"} in the selected date range.
        </div>
      ) : null}

      <section className="card overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-[var(--font-heading)] text-xl text-[#23332d]">Attendance Records</h2>
            <p className="mt-1 text-xs text-[#5e766c]">
            </p>
          </div>
          <p className="text-sm font-semibold text-[#35564a]">{filteredLogs.length} records</p>
        </div>

        {filteredLogs.length === 0 ? (
          <p className="mt-4 text-sm text-[#4f675e]">No attendance records match the selected filters.</p>
        ) : (
          <>
            <table className="mt-4 min-w-full border-separate border-spacing-y-2 text-sm">
              <thead>
                <tr className="text-left text-[#4f675e]">
                  <th className="px-3 py-2 font-semibold">Member Name</th>
                  <th className="px-3 py-2 font-semibold">Member ID</th>
                  <th className="px-3 py-2 font-semibold">Attendance Type</th>
                  <th className="px-3 py-2 font-semibold">Service Session</th>
                  <th className="px-3 py-2 font-semibold">Event Name</th>
                  <th className="px-3 py-2 font-semibold">Event Type</th>
                  <th className="px-3 py-2 font-semibold">Attendance Date</th>
                  <th className="px-3 py-2 font-semibold">Attendance Time</th>
                </tr>
              </thead>
              <tbody>
                {pagedLogs.map((log) => {
                  const attendanceType = normalizeAttendanceType(
                    log.attendance_context,
                    log.attendance_group
                  );
                  const linkedEvent = log.event_id ? eventLookup[log.event_id] : null;

                  return (
                    <tr key={log.id} className="rounded-xl bg-white/85 text-[#30463f] shadow-[0_6px_16px_rgba(56,91,79,0.08)]">
                      <td className="rounded-l-xl px-3 py-2.5 font-semibold">{log.full_name}</td>
                      <td className="px-3 py-2.5">{log.student_id}</td>
                      <td className="px-3 py-2.5">{attendanceType ?? "Unknown"}</td>
                      <td className="px-3 py-2.5">{serviceSessionForLog(log)}</td>
                      <td className="px-3 py-2.5">{linkedEvent?.title ?? "N/A"}</td>
                      <td className="px-3 py-2.5">{linkedEvent?.eventType ?? "N/A"}</td>
                      <td className="px-3 py-2.5">{formatDateMMDDYY(log.attended_date)}</td>
                      <td className="rounded-r-xl px-3 py-2.5">
                        {new Date(log.attended_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-semibold text-[#5e766c]">
                Page {currentPage} of {totalPages} • showing {pagedLogs.length} of {filteredLogs.length} records
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-ghost px-3 py-1.5 text-xs"
                  onClick={() => setPage((previous) => Math.max(1, previous - 1))}
                  disabled={currentPage <= 1}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn-ghost px-3 py-1.5 text-xs"
                  onClick={() => setPage((previous) => Math.min(totalPages, previous + 1))}
                  disabled={currentPage >= totalPages}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="analytics-panel">
        <h2 className="font-[var(--font-heading)] text-lg text-[#23332d]">Analytics Overview</h2>
        {selectedLinkedEventId ? (
          <p className="mt-1 text-sm text-[#5d736a]">
            Showing attendance for{" "}
            <span className="font-semibold text-[#315349]">
              {selectedLinkedEventLabel ?? "the selected linked event"}
            </span>
            .
          </p>
        ) : null}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <LineChart title="Attendees by Day (Last 10)" items={dailyTotals} emptyText="No daily attendance yet." />
          <LineChart title="Attendees by Ministry" items={recordsByGroup} emptyText="No network attendance yet." />
          <LineChart title="Newcomer Visits by Ministry" items={newcomerByGroup} emptyText="No newcomer attendance yet." />
          <LineChart title="Attendees by Attendance Type" items={attendanceByContext} emptyText="No attendance type data yet." />
          <LineChart title="Attendees by Linked Event" items={attendanceByLinkedEvent} emptyText="No linked event attendance yet." />
          <LineChart title="Attendees by Service or Event" items={attendanceByGroup} emptyText="No attendance group data yet." />
          <LineChart title="Newcomers by Ministry" items={demographicAnalytics.newcomersByNetwork} emptyText="No newcomer profiles available." />
          <LineChart title="Attendee Age Distribution" items={demographicAnalytics.ageDistribution} emptyText="No age data available." />
          <LineChart title="Attendee Gender Distribution" items={demographicAnalytics.genderDistribution} emptyText="No gender data available." />
        </div>
      </section>
      </div>
    </div>
  );
}
