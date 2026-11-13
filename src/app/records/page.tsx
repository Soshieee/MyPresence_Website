"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { hasSupabaseEnv, supabase, supabaseEnvIssue } from "@/lib/supabase";
import { AttendanceLog, UserFace } from "@/types";
import {
  CategoryBarsPanel,
  GroupedBarsPanel
} from "@/components/attendance-charts";
import { EventsAnalyticsModule } from "@/components/analytics/events-module";
import { LifegroupAnalyticsModule } from "@/components/analytics/lifegroup-module";
import { MIN_ANALYTICS_DATE } from "@/lib/analytics-data";
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
const RECORDS_PAGE_SIZE = 5;
const MEMBER_SUMMARY_PAGE_SIZE = 5;
const OCCASION_PAGE_SIZE = 5;
const LIFEGROUP_PANEL_PAGE_SIZE = 5;
// P3 Life Group attention-list thresholds (evidence-based review flags).
const LG_ATTENTION_DROP_PCT = 20;
const LG_ATTENTION_MIN_ACTIVITIES = 2;
const LG_ATTENTION_RSVP_CONVERSION_PCT = 50;
const LG_ATTENTION_MIN_YES_RSVP = 3;
const LG_MEMBER_TREND_POINTS = 10;

type AttendancePanel = "records" | "rates" | "analytics";

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
  event_type?: string | null;
};

type Lifegroup = {
  id: string;
  name: string;
  description?: string | null;
  leader_id?: string | null;
  status?: string | null;
  created_at?: string | null;
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
  const [lifegroupLoaded, setLifegroupLoaded] = useState(false);
  const [lifegroupError, setLifegroupError] = useState("");
  const [selectedLifegroupId, setSelectedLifegroupId] = useState<string>("all");
  const [selectedLifegroupMemberId, setSelectedLifegroupMemberId] = useState<string>("all");
  const [lifegroupRangePreset, setLifegroupRangePreset] = useState<LifegroupRangePreset>("7d");
  const [lifegroupFromDate, setLifegroupFromDate] = useState("");
  const [lifegroupToDate, setLifegroupToDate] = useState("");
  const [activityPage, setActivityPage] = useState(0);
  const [reportNotice, setReportNotice] = useState("");
  const [memberSummaryPage, setMemberSummaryPage] = useState(1);
  const [occasionPage, setOccasionPage] = useState(1);
  const [attendancePanel, setAttendancePanel] = useState<AttendancePanel>("records");
  // Full-history attendance dataset, lazy loaded when the Analytics tab is
  // first opened. Still feeds the Event Comparison card.
  const [compareEventIds, setCompareEventIds] = useState<string[]>([]);
  const [timelineLogs, setTimelineLogs] = useState<AttendanceLog[]>([]);
  const [timelineStatus, setTimelineStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

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

  // Equal-length window immediately before the selected lifegroup range —
  // used for the group trend comparison (current vs previous period).
  const lifegroupPrevRange = useMemo(() => {
    const from = new Date(`${lifegroupRange.from}T00:00:00`);
    const to = new Date(`${lifegroupRange.to}T00:00:00`);
    const spanDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1);
    const prevTo = new Date(from);
    prevTo.setDate(prevTo.getDate() - 1);
    const prevFrom = new Date(prevTo);
    prevFrom.setDate(prevFrom.getDate() - (spanDays - 1));
    return { from: toLocalDateInput(prevFrom), to: toLocalDateInput(prevTo) };
  }, [lifegroupRange.from, lifegroupRange.to]);

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
        supabase.from("lifegroup_members").select("*").limit(5000),
        supabase.from("profiles").select("id, first_name, last_name").limit(5000),
        supabase.from("lifegroup_activities").select("*").order("starts_at", { ascending: true }).limit(5000),
        supabase.from("lifegroup_activity_rsvps").select("*").limit(5000),
        supabase.from("lifegroup_attendance").select("*").limit(5000),
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

  // Load the seven lifegroup datasets lazily — only when the Lifegroup tab is
  // first opened — instead of on every page load.
  useEffect(() => {
    if (recordsView !== "lifegroups") return;
    if (lifegroupLoaded) return;

    const load = async () => {
      setLifegroupLoaded(true);
      await fetchLifegroupData();
    };

    void load();
  }, [fetchLifegroupData, lifegroupLoaded, recordsView]);

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

      // descriptor (face embedding) is intentionally not selected here —
      // only the scanner and enrollment flows may load biometric data.
      const usersResult = await supabase.from("users").select("id, student_id, full_name, age, gender, newcomer, created_at");
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
    const load = async () => {
      await fetchLogs();
    };

    void load();
  }, [fetchLogs]);

  // Full attendance history (bounded by MIN_ANALYTICS_DATE) used by the P2
  // interactive timeline so month/year navigation and previous-period
  // overlays are not limited to the currently fetched date range.
  const fetchTimelineLogs = useCallback(async () => {
    if (!hasSupabaseEnv) return;
    setTimelineStatus("loading");
    try {
      let rows: AttendanceLog[] = [];
      const first = await supabase
        .from("attendance")
        .select("id, student_id, full_name, was_newcomer, attendance_context, attendance_group, service_type, event_id, attended_date, attended_at")
        .gte("attended_date", MIN_ANALYTICS_DATE)
        .order("attended_at", { ascending: false });

      if (!first.error) {
        rows = (first.data ?? []) as AttendanceLog[];
      } else if (isMissingServiceTypeColumnError(first.error.message)) {
        const fallback = await supabase
          .from("attendance")
          .select("id, student_id, full_name, was_newcomer, attendance_context, attendance_group, event_id, attended_date, attended_at")
          .gte("attended_date", MIN_ANALYTICS_DATE)
          .order("attended_at", { ascending: false });

        if (fallback.error) throw fallback.error;
        rows = (fallback.data ?? []) as AttendanceLog[];
      } else {
        throw first.error;
      }

      setTimelineLogs(rows);
      setTimelineStatus("ready");
    } catch (err: unknown) {
      console.error(err);
      setTimelineStatus("error");
    }
  }, []);

  useEffect(() => {
    if (attendancePanel !== "analytics") return;
    if (timelineStatus !== "idle") return;

    const load = async () => {
      await fetchTimelineLogs();
    };

    void load();
  }, [attendancePanel, fetchTimelineLogs, timelineStatus]);

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

  // The selected event only filters records while the current attendance-type
  // filter still offers it; derive the effective selection during render
  // instead of clearing it in an effect.
  const activeLinkedEventId =
    selectedLinkedEventId &&
    availableLinkedEventOptions.some((event) => event.id === selectedLinkedEventId)
      ? selectedLinkedEventId
      : null;

  const selectedLinkedEventLabel = useMemo(() => {
    if (!activeLinkedEventId) return null;
    return linkedEventLabelById.get(activeLinkedEventId) ?? `Deleted Event (${activeLinkedEventId.slice(0, 8)})`;
  }, [activeLinkedEventId, linkedEventLabelById]);

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
        !activeLinkedEventId ||
        log.event_id === activeLinkedEventId;

      const matchesSearch =
        normalizedSearch.length === 0 ||
        log.full_name.toLowerCase().includes(normalizedSearch) ||
        log.student_id.toLowerCase().includes(normalizedSearch);

      return matchesNetwork && matchesAttendanceType && matchesLinkedEvent && matchesSearch;
    });
  }, [activeLinkedEventId, attendanceTypeFilter, logs, normalizedSearch, selectedNetworkSet, userNetworkMap]);

  const hasNoRecordsForSelectedLinkedEvent =
    Boolean(activeLinkedEventId) &&
    filteredLogs.length === 0;

  // Reset pagination whenever the active filter set changes. This uses the
  // render-phase state adjustment pattern (guard + previous-value snapshot)
  // rather than a setState-in-effect reset.
  const filterIdentity = [
    attendanceTypeFilter,
    normalizedSearch,
    range.from,
    range.to,
    activeLinkedEventId ?? "",
    [...selectedNetworkSet].sort().join("|")
  ].join("\u0000");

  const [prevFilterIdentity, setPrevFilterIdentity] = useState(filterIdentity);
  if (prevFilterIdentity !== filterIdentity) {
    setPrevFilterIdentity(filterIdentity);
    setPage(1);
    setMemberSummaryPage(1);
    setOccasionPage(1);
  }

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

  // ---------------------------------------------------------------------------
  // P1 attendance analytics foundation
  // ---------------------------------------------------------------------------
  const uniqueAttendeeCount = useMemo(
    () => new Set(filteredLogs.map((log) => log.student_id)).size,
    [filteredLogs]
  );

  // Members eligible in the selected window: enrolled on or before the window
  // end. Inactive members remain included for historical analysis (approved
  // opportunity-model rule); they are flagged in the member summary instead.
  const rosterEligibleCount = useMemo(() => {
    if (users.length === 0) return 0;
    const endDate = range.to;
    return users.filter((user) => {
      const enrolledDate = (user.created_at ?? "").slice(0, 10);
      return !enrolledDate || enrolledDate <= endDate;
    }).length;
  }, [range.to, users]);

  // Observed occasions: a context/date pair counts as an occasion when at
  // least one check-in was recorded for it in the filtered window. Sunday
  // Service is one opportunity per day across First/Second Service (approved
  // model); each network context is its own opportunity type.
  const occasionDatesByContext = useMemo(() => {
    const map = new Map<AttendanceType | "Unknown", Set<string>>();

    for (const log of filteredLogs) {
      const context =
        normalizeAttendanceType(log.attendance_context, log.attendance_group) ?? "Unknown";
      let dates = map.get(context);
      if (!dates) {
        dates = new Set<string>();
        map.set(context, dates);
      }
      dates.add(log.attended_date);
    }

    return map;
  }, [filteredLogs]);

  const occasionRows = useMemo(() => {
    const contexts: Array<AttendanceType | "Unknown"> = [...ATTENDANCE_TYPES, "Unknown"];

    return contexts
      .map((context) => {
        const dates = occasionDatesByContext.get(context);
        const contextLogs = filteredLogs.filter(
          (log) =>
            (normalizeAttendanceType(log.attendance_context, log.attendance_group) ?? "Unknown") ===
            context
        );
        const uniqueAttendees = new Set(contextLogs.map((log) => log.student_id)).size;
        const occasions = dates?.size ?? 0;
        const checkIns = contextLogs.length;

        return {
          context,
          occasions,
          checkIns,
          uniqueAttendees,
          avgPerOccasion: occasions > 0 ? Math.round((checkIns / occasions) * 10) / 10 : 0,
          rosterShare: rosterEligibleCount > 0 ? (uniqueAttendees / rosterEligibleCount) * 100 : null
        };
      })
      .filter((row) => row.checkIns > 0);
  }, [filteredLogs, occasionDatesByContext, rosterEligibleCount]);

  type MemberCheckInSummaryRow = {
    studentId: string;
    fullName: string;
    networkLabel: string | null;
    isActive: boolean | null;
    enrolledDate: string | null;
    checkIns: number;
    attendedOccasions: number;
    eligibleOccasions: number;
    percent: number | null;
    lastAttendedDate: string | null;
  };

  const memberCheckInSummary = useMemo<MemberCheckInSummaryRow[]>(() => {
    const occasions: Array<{ context: AttendanceType | "Unknown"; date: string }> = [];
    for (const [context, dates] of occasionDatesByContext) {
      for (const date of dates) occasions.push({ context, date });
    }

    const logsByStudent = new Map<string, AttendanceLog[]>();
    for (const log of filteredLogs) {
      const list = logsByStudent.get(log.student_id);
      if (list) list.push(log);
      else logsByStudent.set(log.student_id, [log]);
    }

    return users
      .map((user) => {
        const enrolledDate = (user.created_at ?? "").slice(0, 10) || null;
        const userLogs = logsByStudent.get(user.student_id) ?? [];
        const attended = new Set<string>();
        let lastAttendedDate: string | null = null;

        for (const log of userLogs) {
          const context =
            normalizeAttendanceType(log.attendance_context, log.attendance_group) ?? "Unknown";
          attended.add(`${context}|${log.attended_date}`);
          if (!lastAttendedDate || log.attended_date > lastAttendedDate) {
            lastAttendedDate = log.attended_date;
          }
        }

        let eligibleOccasions = 0;
        for (const occasion of occasions) {
          if (enrolledDate && occasion.date < enrolledDate) continue;
          eligibleOccasions += 1;
        }

        const networkKey = userNetworkMap.get(user.student_id);

        return {
          studentId: user.student_id,
          fullName: user.full_name,
          networkLabel: networkKey ? NETWORK_LABELS[networkKey] : null,
          isActive: user.is_active ?? null,
          enrolledDate,
          checkIns: userLogs.length,
          attendedOccasions: attended.size,
          eligibleOccasions,
          percent:
            eligibleOccasions > 0
              ? Math.round((attended.size / eligibleOccasions) * 1000) / 10
              : null,
          lastAttendedDate
        };
      })
      .sort((a, b) => {
        const pctA = a.percent ?? -1;
        const pctB = b.percent ?? -1;
        if (pctB !== pctA) return pctB - pctA;
        if (b.checkIns !== a.checkIns) return b.checkIns - a.checkIns;
        return a.fullName.localeCompare(b.fullName);
      });
  }, [filteredLogs, occasionDatesByContext, userNetworkMap, users]);

  const memberSummaryTotalPages = Math.max(
    1,
    Math.ceil(memberCheckInSummary.length / MEMBER_SUMMARY_PAGE_SIZE)
  );
  const memberSummaryCurrentPage = Math.min(memberSummaryPage, memberSummaryTotalPages);
  const pagedMemberSummary = memberCheckInSummary.slice(
    (memberSummaryCurrentPage - 1) * MEMBER_SUMMARY_PAGE_SIZE,
    memberSummaryCurrentPage * MEMBER_SUMMARY_PAGE_SIZE
  );

  const occasionTotalPages = Math.max(1, Math.ceil(occasionRows.length / OCCASION_PAGE_SIZE));
  const occasionCurrentPage = Math.min(occasionPage, occasionTotalPages);
  const pagedOccasionRows = occasionRows.slice(
    (occasionCurrentPage - 1) * OCCASION_PAGE_SIZE,
    occasionCurrentPage * OCCASION_PAGE_SIZE
  );

  // ---------------------------------------------------------------------------
  // P2 interactive timeline + event comparison
  // ---------------------------------------------------------------------------
  const timelineFilteredLogs = useMemo(() => {
    return timelineLogs.filter((log) => {
      const userNetwork = userNetworkMap.get(log.student_id);
      const matchesNetwork =
        selectedNetworkSet.size === 0 || (userNetwork ? selectedNetworkSet.has(userNetwork) : false);
      const matchesAttendanceType =
        attendanceTypeFilter === "all" ||
        normalizeAttendanceType(log.attendance_context, log.attendance_group) === attendanceTypeFilter;
      const matchesLinkedEvent = !activeLinkedEventId || log.event_id === activeLinkedEventId;
      return matchesNetwork && matchesAttendanceType && matchesLinkedEvent;
    });
  }, [activeLinkedEventId, attendanceTypeFilter, selectedNetworkSet, timelineLogs, userNetworkMap]);

  const toggleCompareEvent = useCallback((eventId: string) => {
    setCompareEventIds((previous) => {
      if (previous.includes(eventId)) return previous.filter((id) => id !== eventId);
      if (previous.length >= 3) return previous;
      return [...previous, eventId];
    });
  }, []);

  const eventComparisonRows = useMemo(() => {
    const selected = compareEventIds
      .map((id) => linkedEvents.find((event) => event.id === id))
      .filter((event): event is LinkedEvent => Boolean(event));

    return selected.map((event) => {
      const linked = timelineFilteredLogs.filter((log) => log.event_id === event.id);
      let matched = linked;
      let matchedBy: "linked" | "date" | "none" = linked.length > 0 ? "linked" : "none";
      if (matched.length === 0 && event.event_date) {
        matched = timelineFilteredLogs.filter((log) => log.attended_date === event.event_date);
        matchedBy = matched.length > 0 ? "date" : "none";
      }
      return {
        id: event.id,
        title: event.title,
        eventDate: event.event_date,
        matchedBy,
        checkIns: matched.length,
        uniqueAttendees: new Set(matched.map((log) => log.student_id)).size,
        newcomers: new Set(matched.filter((log) => log.was_newcomer).map((log) => log.student_id)).size
      };
    });
  }, [compareEventIds, linkedEvents, timelineFilteredLogs]);

  const eventComparisonData = useMemo(
    () =>
      eventComparisonRows.map((row) => ({
        name: row.eventDate ? `${row.title} (${formatDateMMDDYY(row.eventDate)})` : `${row.title} (no date)`,
        "Check-Ins": row.checkIns,
        "Unique Attendees": row.uniqueAttendees,
        Newcomers: row.newcomers
      })),
    [eventComparisonRows, formatDateMMDDYY]
  );

  const eventsForComparison = useMemo(
    () =>
      [...linkedEvents].sort((a, b) => {
        const dateA = a.event_date ?? "";
        const dateB = b.event_date ?? "";
        return dateB.localeCompare(dateA);
      }),
    [linkedEvents]
  );

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

    // Previous equal-length period (for group trend deltas and the review list).
    const activitiesInPrevRange = lifegroupActivities.filter((activity) => {
      if (selectedLifegroupId !== "all" && activity.lifegroup_id !== selectedLifegroupId) return false;
      const date = activityDate(activity);
      return dateInRange(date, lifegroupPrevRange.from, lifegroupPrevRange.to);
    });
    const prevPresentByGroup = new Map<string, number>();
    {
      const prevByKey = new Map<string, { lifegroupId: string; present: boolean }>();
      for (const row of lifegroupAttendance) {
        const activity = row.activity_id ? activityById.get(row.activity_id) : undefined;
        const lifegroupId = row.lifegroup_id ?? activity?.lifegroup_id ?? null;
        if (!lifegroupId) continue;
        if (selectedLifegroupId !== "all" && lifegroupId !== selectedLifegroupId) continue;
        const date = attendanceDate(row, activityById);
        if (!dateInRange(date, lifegroupPrevRange.from, lifegroupPrevRange.to)) continue;
        const key = row.activity_id
          ? `${row.activity_id}|${row.user_id}`
          : `${lifegroupId}|${row.user_id}|${date ?? row.id ?? "unknown"}`;
        const existing = prevByKey.get(key);
        prevByKey.set(key, {
          lifegroupId,
          present: (existing?.present ?? false) || isPresentAttendance(row)
        });
      }
      for (const entry of prevByKey.values()) {
        if (!entry.present) continue;
        prevPresentByGroup.set(entry.lifegroupId, (prevPresentByGroup.get(entry.lifegroupId) ?? 0) + 1);
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
      const groupPrevActivities = activitiesInPrevRange.filter((activity) => activity.lifegroup_id === group.id).length;
      const groupPrevAttendance = prevPresentByGroup.get(group.id) ?? 0;
      const prevAvgPerActivity = groupPrevActivities > 0 ? groupPrevAttendance / groupPrevActivities : null;
      const currentAvgPerActivity = groupActivities.length ? baseAttendance / groupActivities.length : 0;
      const attendanceDeltaPct =
        prevAvgPerActivity !== null && prevAvgPerActivity > 0 && groupActivities.length > 0
          ? Math.round(((currentAvgPerActivity - prevAvgPerActivity) / prevAvgPerActivity) * 100)
          : null;
      const groupYesRsvps = groupRsvps.filter((row) => normalizeRsvpResponse(row.response ?? null) === "yes").length;
      const rsvpConversionPct =
        groupYesRsvps > 0 ? Math.round((baseAttendance / groupYesRsvps) * 100) : null;

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
        yes: groupYesRsvps,
        no: groupRsvps.filter((row) => normalizeRsvpResponse(row.response ?? null) === "no").length,
        maybe: groupRsvps.filter((row) => normalizeRsvpResponse(row.response ?? null) === "maybe").length,
        avgAttendancePerActivity: currentAvgPerActivity,
        prevActivities: groupPrevActivities,
        prevAttendance: groupPrevAttendance,
        prevAvgPerActivity,
        attendanceDeltaPct,
        rsvpConversionPct,
        color: GROUP_COLORS[colorKeys[index % colorKeys.length]] ?? "#0f766e"
      };
    });

    // Evidence-based review list: groups whose numbers changed in ways worth
    // an administrator's attention. Flags never label a group as failing.
    const attentionList = perGroup
      .map((group) => {
        const reasons: string[] = [];
        if (
          group.prevActivities >= LG_ATTENTION_MIN_ACTIVITIES &&
          group.activities >= 1 &&
          group.attendanceDeltaPct !== null &&
          group.attendanceDeltaPct <= -LG_ATTENTION_DROP_PCT
        ) {
          reasons.push(
            `Attendance per activity fell ${Math.abs(group.attendanceDeltaPct)}% vs the previous period (${
              group.prevAvgPerActivity?.toFixed(1) ?? "—"
            } → ${group.avgAttendancePerActivity.toFixed(1)}).`
          );
        }
        if (
          group.yes >= LG_ATTENTION_MIN_YES_RSVP &&
          group.rsvpConversionPct !== null &&
          group.rsvpConversionPct <= LG_ATTENTION_RSVP_CONVERSION_PCT
        ) {
          reasons.push(
            `Only ${group.rsvpConversionPct}% of yes-RSVPs were recorded as attended (${group.attendance} of ${group.yes}).`
          );
        }
        if (group.activities === 0 && group.members > 0) {
          reasons.push("No activities recorded in the selected range.");
        }
        return { id: group.id, name: group.name, reasons };
      })
      .filter((entry) => entry.reasons.length > 0);

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

    // Every member across the scoped groups — powers the member filter when
    // All Lifegroups is selected.
    const allMembers = Array.from(memberIds)
      .map((userId) => ({ user_id: userId, name: displayProfileName(profileById.get(userId)) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Per-member attendance comparison for a selected lifegroup: attended vs
    // eligible activities in range (counted only from the member's effective
    // join date), percentage, recency, streak, and a chronological trend.
    // Zero-attendance members are included so nobody silently disappears.
    const selectedGroup = scopedGroups.find((group) => group.id === selectedLifegroupId) ?? null;
    let memberComparison: {
      groupName: string;
      totalAttendance: number;
      averagePercent: number | null;
      rows: Array<{
        userId: string;
        name: string;
        role: string;
        status: string;
        joinedDate: string | null;
        joinUnknown: boolean;
        attended: number;
        eligible: number;
        percent: number | null;
        lastAttended: string | null;
        streakLabel: string;
        trend: Array<{ label: string; value: number }>;
      }>;
    } | null = null;

    if (selectedGroup) {
      const groupActivitiesAll = activitiesInRange
        .filter((activity) => activity.lifegroup_id === selectedGroup.id)
        .sort((a, b) => (activityDate(a) ?? "").localeCompare(activityDate(b) ?? ""));
      const groupMemberRows = membershipsByGroup.get(selectedGroup.id) ?? [];
      const groupPresentRows = presentRows.filter((row) => row.lifegroupId === selectedGroup.id);
      const groupJoinedFallback = dateKey(selectedGroup.created_at ?? null);

      const comparisonRows = groupMemberRows
        .map((membership) => {
          const joinedDate = dateKey(membership.joined_at ?? null) ?? groupJoinedFallback;
          const joinUnknown = !membership.joined_at && !selectedGroup.created_at;
          // Opportunities before the member joined the group never count.
          const eligibleActivities = joinedDate
            ? groupActivitiesAll.filter((activity) => (activityDate(activity) ?? "") >= joinedDate)
            : groupActivitiesAll;
          const memberPresentKeys = new Set(
            groupPresentRows
              .filter((row) => row.userId === membership.user_id)
              .map((row) => row.activityId ?? `date:${row.date ?? ""}`)
          );
          const eligible = eligibleActivities.length;
          const attended = memberPresentKeys.size;
          const trendFull = eligibleActivities.map((activity) => ({
            label: activityDate(activity)?.slice(5) ?? "—",
            value: memberPresentKeys.has(activity.id) ? 1 : 0
          }));
          const trend = trendFull.slice(-LG_MEMBER_TREND_POINTS);

          let streakLabel = "No activities yet";
          if (trendFull.length > 0) {
            const lastValue = trendFull[trendFull.length - 1].value;
            let streak = 0;
            for (let index = trendFull.length - 1; index >= 0; index -= 1) {
              if (trendFull[index].value !== lastValue) break;
              streak += 1;
            }
            streakLabel = lastValue === 1 ? `Attended last ${streak}` : `Missed last ${streak}`;
          }

          let lastAttended: string | null = null;
          for (const activity of eligibleActivities) {
            if (memberPresentKeys.has(activity.id)) lastAttended = activityDate(activity);
          }

          return {
            userId: membership.user_id,
            name: displayProfileName(profileById.get(membership.user_id)),
            role: membership.role ?? "member",
            status: membership.status ?? "unknown",
            joinedDate,
            joinUnknown,
            attended,
            eligible,
            percent: eligible > 0 ? Math.round((attended / eligible) * 100) : null,
            lastAttended,
            streakLabel,
            trend
          };
        })
        .sort((a, b) => {
          const pctA = a.percent ?? -1;
          const pctB = b.percent ?? -1;
          if (pctB !== pctA) return pctB - pctA;
          if (b.attended !== a.attended) return b.attended - a.attended;
          return a.name.localeCompare(b.name);
        });

      const scoredRows = comparisonRows.filter((row) => row.percent !== null);
      memberComparison = {
        groupName: selectedGroup.name,
        totalAttendance: groupPresentRows.length,
        averagePercent:
          scoredRows.length > 0
            ? Math.round(scoredRows.reduce((sum, row) => sum + (row.percent ?? 0), 0) / scoredRows.length)
            : null,
        rows: comparisonRows
      };
    }

    // Cross-group member view: with All Lifegroups + a member selected, show
    // how that member attends in every group they belong to.
    let crossGroupMember: {
      memberName: string;
      rows: Array<{
        groupId: string;
        groupName: string;
        attended: number;
        eligible: number;
        percent: number | null;
        lastAttended: string | null;
      }>;
    } | null = null;

    if (selectedLifegroupId === "all" && selectedLifegroupMemberId !== "all") {
      const memberPresentByGroup = new Map<string, Set<string>>();
      for (const row of presentRows) {
        let set = memberPresentByGroup.get(row.lifegroupId);
        if (!set) {
          set = new Set<string>();
          memberPresentByGroup.set(row.lifegroupId, set);
        }
        set.add(row.activityId ?? `date:${row.date ?? ""}`);
      }

      const rows = lifegroups
        .filter((group) =>
          (membershipsByGroup.get(group.id) ?? []).some((row) => row.user_id === selectedLifegroupMemberId)
        )
        .map((group) => {
          const membership = (membershipsByGroup.get(group.id) ?? []).find(
            (row) => row.user_id === selectedLifegroupMemberId
          );
          const joinedDate =
            dateKey(membership?.joined_at ?? null) ?? dateKey(group.created_at ?? null);
          const groupActivitiesAll = activitiesInRange
            .filter((activity) => activity.lifegroup_id === group.id)
            .sort((a, b) => (activityDate(a) ?? "").localeCompare(activityDate(b) ?? ""));
          const eligibleActivities = joinedDate
            ? groupActivitiesAll.filter((activity) => (activityDate(activity) ?? "") >= joinedDate)
            : groupActivitiesAll;
          const attendedKeys = memberPresentByGroup.get(group.id) ?? new Set<string>();
          const attended = attendedKeys.size;
          const eligible = eligibleActivities.length;
          let lastAttended: string | null = null;
          for (const activity of eligibleActivities) {
            if (attendedKeys.has(activity.id)) lastAttended = activityDate(activity);
          }
          return {
            groupId: group.id,
            groupName: group.name,
            attended,
            eligible,
            percent: eligible > 0 ? Math.round((attended / eligible) * 100) : null,
            lastAttended
          };
        });

      crossGroupMember = {
        memberName: displayProfileName(profileById.get(selectedLifegroupMemberId)),
        rows
      };
    }

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
      attentionList,
      allMembers,
      members,
      memberComparison,
      crossGroupMember,
      recentActivities,
      reportAttendanceAvailable: reportAttendanceByActivity.size > 0 || reportAttendanceByGroup.size > 0
    };
  }, [
    formatDateMMDDYY,
    lifegroupActivities,
    lifegroupAttendance,
    lifegroupMembers,
    lifegroupPrevRange.from,
    lifegroupPrevRange.to,
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
  const memberExtrasById = useMemo(() => {
    const map = new Map<
      string,
      { lastAttended: string | null; streakLabel: string; joinedDate: string | null; joinUnknown: boolean }
    >();
    for (const row of lifegroupAnalytics.memberComparison?.rows ?? []) {
      map.set(row.userId, {
        lastAttended: row.lastAttended,
        streakLabel: row.streakLabel,
        joinedDate: row.joinedDate,
        joinUnknown: row.joinUnknown
      });
    }
    return map;
  }, [lifegroupAnalytics]);
  const activityPageCount = Math.ceil(lifegroupAnalytics.recentActivities.length / LIFEGROUP_PANEL_PAGE_SIZE);
  const safeActivityPage = Math.min(activityPage, Math.max(activityPageCount - 1, 0));
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
        { label: "Unique Attendees", value: uniqueAttendeeCount },
        { label: "Check-Ins", value: filteredLogs.length },
        { label: "Newcomers (people)", value: newcomerAttendeeCount },
        { label: "Repeat Attendees", value: returningAttendeeCount },
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
            {
              title: `Attendance Rate by Occasion (roster: ${rosterEligibleCount} eligible members)`,
              note: "An occasion is a date with at least one recorded check-in for that attendance type. Sunday Service counts once per day across both services.",
              columns: ["Occasion", "Occasions", "Check-Ins", "Unique Attendees", "Avg / Occasion", "% of Roster"],
              rightAlignFrom: 1,
              rows: occasionRows.map((row) => [
                row.context,
                row.occasions,
                row.checkIns,
                row.uniqueAttendees,
                row.avgPerOccasion,
                row.rosterShare === null ? "—" : `${row.rosterShare.toFixed(1)}%`
              ])
            },
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
                "Avg / Activity",
                "Δ vs Prev Period"
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
                group.avgAttendancePerActivity.toFixed(1),
                group.attendanceDeltaPct === null
                  ? "—"
                  : `${group.attendanceDeltaPct > 0 ? "+" : ""}${group.attendanceDeltaPct}%`
              ])
            },
            ...(lifegroupAnalytics.attentionList.length > 0
              ? [
                  {
                    title: "Groups that may need review (evidence-based flags)",
                    columns: ["Lifegroup", "Observations"],
                    rows: lifegroupAnalytics.attentionList.map((entry) => [
                      entry.name,
                      entry.reasons.join(" ")
                    ])
                  }
                ]
              : [])
          ]
        },
        ...(selectedLifegroupId !== "all"
          ? [
              {
                title: `Members of ${selectedLifegroupName}`,
                tables: [
                  {
                    title: "Membership",
                    columns: ["Member", "Role", "Membership Status", "Last Attended", "Recent"],
                    rows: lifegroupAnalytics.members.map((member) => {
                      const extras = memberExtrasById.get(member.user_id);
                      return [
                        member.name,
                        member.role,
                        member.status,
                        extras?.lastAttended ? formatDateMMDDYY(extras.lastAttended) : "Never in range",
                        extras?.streakLabel ?? "—"
                      ];
                    })
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
          {!lifegroupLoading ? (
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
          ) : null}

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
                <option value="all">All Lifegroups</option>
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
                disabled={
                  selectedLifegroupId === "all"
                    ? lifegroupAnalytics.allMembers.length === 0
                    : lifegroupAnalytics.members.length === 0
                }
              >
                <option value="all">All Members</option>
                {(selectedLifegroupId === "all"
                  ? lifegroupAnalytics.allMembers
                  : lifegroupAnalytics.members
                ).map((member) => (
                  <option key={member.user_id} value={member.user_id}>{member.name}</option>
                ))}
              </select>
              {selectedLifegroupId === "all" && selectedLifegroupMemberId !== "all" ? (
                <p className="mt-1 text-[11px] text-[#71847c]">
                  Showing this member across all their lifegroups.
                </p>
              ) : null}
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

          <LifegroupAnalyticsModule />

          {lifegroupAnalytics.attentionList.length > 0 ? (
            <section className="rounded-2xl border border-[#e5cf93] bg-[#fffaf0] p-4">
              <h2 className="font-[var(--font-heading)] text-lg text-[#7a5a17]">Groups That May Need Review</h2>
              <p className="mt-1 text-xs text-[#8a6d3b]">
                Evidence-based flags only — these numbers changed in ways worth a look. Review and decide; nothing here
                is an automatic conclusion.
              </p>
              <div className="mt-3 grid gap-2">
                {lifegroupAnalytics.attentionList.map((entry) => (
                  <div key={entry.id} className="rounded-xl bg-white/85 px-3 py-2">
                    <p className="font-semibold text-[#315349]">{entry.name}</p>
                    <ul className="mt-1 list-disc pl-5 text-xs text-[#6a5a2a]">
                      {entry.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {selectedLifegroupId !== "all" ? (
            <section className="analytics-panel">
              <h2 className="font-[var(--font-heading)] text-lg text-[#23332d]">Members of {selectedLifegroupName}</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#d6e1dd] text-[10px] uppercase tracking-[0.08em] text-[#71847c]">
                      <th className="px-2 py-2">Member</th>
                      <th className="px-2 py-2">Role</th>
                      <th className="px-2 py-2">Membership Status</th>
                      <th className="px-2 py-2">Last Attended</th>
                      <th className="px-2 py-2">Recent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lifegroupAnalytics.members.map((member) => {
                      const extras = memberExtrasById.get(member.user_id);
                      return (
                        <tr key={member.user_id} className="border-b border-[#edf2ef] last:border-0">
                          <td className="px-2 py-3 font-semibold text-[#2f4d43]">
                            {member.name}
                            {extras?.joinUnknown ? (
                              <span className="ml-2 text-[10px] font-normal text-[#8a6d3b]">(join date unknown)</span>
                            ) : null}
                          </td>
                          <td className="px-2 py-3 capitalize text-[#5e766c]">{member.role}</td>
                          <td className="px-2 py-3 capitalize text-[#5e766c]">{member.status}</td>
                          <td className="px-2 py-3 text-[#5e766c]">
                            {extras?.lastAttended ? formatDateMMDDYY(extras.lastAttended) : "Never in range"}
                          </td>
                          <td className="px-2 py-3 text-[#5e766c]">{extras?.streakLabel ?? "—"}</td>
                        </tr>
                      );
                    })}
                    {!lifegroupAnalytics.members.length ? (
                      <tr>
                        <td colSpan={5} className="px-2 py-6 text-center text-sm text-[#71847c]">
                          No membership records for this lifegroup.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {lifegroupAnalytics.crossGroupMember ? (
            <section className="analytics-panel">
              <h2 className="font-[var(--font-heading)] text-lg text-[#23332d]">
                Member Across Lifegroups — {lifegroupAnalytics.crossGroupMember.memberName}
              </h2>
              <p className="mt-1 text-sm text-[#5d7269]">
                How this member attends in every group they belong to, using the same join-date-aware eligibility rule.
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#d6e1dd] text-[10px] uppercase tracking-[0.08em] text-[#71847c]">
                      <th className="px-2 py-2">Lifegroup</th>
                      <th className="px-2 py-2 text-right">Attended</th>
                      <th className="px-2 py-2 text-right">Eligible (since joined)</th>
                      <th className="px-2 py-2 text-right">Attendance %</th>
                      <th className="px-2 py-2 text-right">Last Attended</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lifegroupAnalytics.crossGroupMember.rows.map((row) => (
                      <tr key={row.groupId} className="border-b border-[#edf2ef] last:border-0">
                        <td className="px-2 py-3 font-semibold text-[#2f4d43]">{row.groupName}</td>
                        <td className="px-2 py-3 text-right text-[#315349]">{row.attended}</td>
                        <td className="px-2 py-3 text-right text-[#5e766c]">{row.eligible}</td>
                        <td className="px-2 py-3 text-right font-semibold text-[#315349]">
                          {row.percent === null ? "—" : `${row.percent}%`}
                        </td>
                        <td className="px-2 py-3 text-right text-[#5e766c]">
                          {row.lastAttended ? formatDateMMDDYY(row.lastAttended) : "Never in range"}
                        </td>
                      </tr>
                    ))}
                    {lifegroupAnalytics.crossGroupMember.rows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-2 py-6 text-center text-sm text-[#71847c]">
                          This member has no lifegroup memberships.
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
                      <td colSpan={6} className="px-2 py-6 text-center text-sm text-[#71847c]">
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
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Unique Attendees</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">{uniqueAttendeeCount}</p>
          <p className="mt-1 text-[11px] text-[#5e766c]">distinct people in the selected window</p>
        </article>
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Check-Ins</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">{filteredLogs.length}</p>
          <p className="mt-1 text-[11px] text-[#5e766c]">total attendance records</p>
        </article>
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Newcomers</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">{newcomerAttendeeCount}</p>
          <p className="mt-1 text-[11px] text-[#5e766c]">distinct first-time people</p>
        </article>
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Repeat Attendees</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">{returningAttendeeCount}</p>
          <p className="mt-1 text-[11px] text-[#5e766c]">people with 2+ check-ins</p>
        </article>
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Newcomer Visits</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">{newcomerCheckInCount}</p>
          <p className="mt-1 text-[11px] text-[#5e766c]">newcomer check-in records</p>
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
                value={activeLinkedEventId ?? ""}
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
            {activeLinkedEventId ? (
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

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Attendance analytics sections">
        <button
          type="button"
          role="tab"
          aria-selected={attendancePanel === "records"}
          onClick={() => setAttendancePanel("records")}
          className={attendancePanel === "records" ? "btn-primary" : "btn-ghost"}
        >
          Records
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={attendancePanel === "rates"}
          onClick={() => setAttendancePanel("rates")}
          className={attendancePanel === "rates" ? "btn-primary" : "btn-ghost"}
        >
          Rates & Members
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={attendancePanel === "analytics"}
          onClick={() => setAttendancePanel("analytics")}
          className={attendancePanel === "analytics" ? "btn-primary" : "btn-ghost"}
        >
          Analytics
        </button>
      </div>

      {attendancePanel === "records" ? (
      <section className="card overflow-x-auto reveal">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-[var(--font-heading)] text-xl text-[#23332d]">Attendance Records</h2>
            <p className="mt-1 text-xs text-[#5e766c]">Every check-in in the selected window, newest first.</p>
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
      ) : null}

      {attendancePanel === "rates" ? (
      <>
      <section className="card overflow-x-auto reveal">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-[var(--font-heading)] text-xl text-[#23332d]">Attendance Rate by Occasion</h2>
            <p className="mt-1 text-xs text-[#5e766c]">
              An occasion is a date with at least one recorded check-in for that attendance type. Sunday Service counts
              once per day across both services. Roster share uses the {rosterEligibleCount} members enrolled by the end
              of the window.
            </p>
          </div>
        </div>

        {occasionRows.length === 0 ? (
          <p className="mt-4 text-sm text-[#4f675e]">No attendance occasions in the selected window.</p>
        ) : (
          <table className="mt-4 min-w-full border-separate border-spacing-y-2 text-sm">
            <thead>
              <tr className="text-left text-[#4f675e]">
                <th className="px-3 py-2 font-semibold">Occasion</th>
                <th className="px-3 py-2 font-semibold">Occasions</th>
                <th className="px-3 py-2 font-semibold">Check-Ins</th>
                <th className="px-3 py-2 font-semibold">Unique Attendees</th>
                <th className="px-3 py-2 font-semibold">Avg / Occasion</th>
                <th className="px-3 py-2 font-semibold">% of Roster</th>
              </tr>
            </thead>
            <tbody>
              {pagedOccasionRows.map((row) => (
                <tr key={row.context} className="rounded-xl bg-white/85 text-[#30463f] shadow-[0_6px_16px_rgba(56,91,79,0.08)]">
                  <td className="rounded-l-xl px-3 py-2.5 font-semibold">{row.context}</td>
                  <td className="px-3 py-2.5">{row.occasions}</td>
                  <td className="px-3 py-2.5">{row.checkIns}</td>
                  <td className="px-3 py-2.5">{row.uniqueAttendees}</td>
                  <td className="px-3 py-2.5">{row.avgPerOccasion}</td>
                  <td className="rounded-r-xl px-3 py-2.5 font-semibold text-[#315349]">
                    {row.rosterShare === null ? "—" : `${row.rosterShare.toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {occasionTotalPages > 1 ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold text-[#5e766c]">
              Page {occasionCurrentPage} of {occasionTotalPages} • showing {pagedOccasionRows.length} of{" "}
              {occasionRows.length} occasion types
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-ghost px-3 py-1.5 text-xs"
                onClick={() => setOccasionPage((previous) => Math.max(1, previous - 1))}
                disabled={occasionCurrentPage <= 1}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn-ghost px-3 py-1.5 text-xs"
                onClick={() => setOccasionPage((previous) => Math.min(occasionTotalPages, previous + 1))}
                disabled={occasionCurrentPage >= occasionTotalPages}
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="card overflow-x-auto reveal">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-[var(--font-heading)] text-xl text-[#23332d]">Member Check-In Summary</h2>
            <p className="mt-1 text-xs text-[#5e766c]">
              Attendance % = attended occasions ÷ eligible occasions. Occasions are observed event dates in the selected
              window; dates before member enrollment are excluded. Inactive members stay listed with an Inactive tag so
              history is never hidden. A dash means no eligible occasions for that member yet.
            </p>
          </div>
          <p className="text-sm font-semibold text-[#35564a]">{memberCheckInSummary.length} members</p>
        </div>

        {memberCheckInSummary.length === 0 ? (
          <p className="mt-4 text-sm text-[#4f675e]">No registered members found.</p>
        ) : (
          <>
            <table className="mt-4 min-w-full border-separate border-spacing-y-2 text-sm">
              <thead>
                <tr className="text-left text-[#4f675e]">
                  <th className="px-3 py-2 font-semibold">Member</th>
                  <th className="px-3 py-2 font-semibold">Ministry</th>
                  <th className="px-3 py-2 font-semibold">Check-Ins</th>
                  <th className="px-3 py-2 font-semibold">Eligible Occasions</th>
                  <th className="px-3 py-2 font-semibold">Attendance %</th>
                  <th className="px-3 py-2 font-semibold">Last Attended</th>
                </tr>
              </thead>
              <tbody>
                {pagedMemberSummary.map((row) => (
                  <tr key={row.studentId} className="rounded-xl bg-white/85 text-[#30463f] shadow-[0_6px_16px_rgba(56,91,79,0.08)]">
                    <td className="rounded-l-xl px-3 py-2.5">
                      <span className="font-semibold">{row.fullName}</span>
                      {row.isActive === false ? (
                        <span className="ml-2 rounded-full bg-[#f4e7e7] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#8a3f46]">
                          Inactive
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">{row.networkLabel ?? "—"}</td>
                    <td className="px-3 py-2.5">{row.checkIns}</td>
                    <td className="px-3 py-2.5">{row.eligibleOccasions}</td>
                    <td className="px-3 py-2.5 font-semibold text-[#315349]">
                      {row.percent === null ? "—" : `${row.percent}%`}
                    </td>
                    <td className="rounded-r-xl px-3 py-2.5">
                      {row.lastAttendedDate ? formatDateMMDDYY(row.lastAttendedDate) : "Never"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-semibold text-[#5e766c]">
                Page {memberSummaryCurrentPage} of {memberSummaryTotalPages} • showing {pagedMemberSummary.length} of{" "}
                {memberCheckInSummary.length} members
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-ghost px-3 py-1.5 text-xs"
                  onClick={() => setMemberSummaryPage((previous) => Math.max(1, previous - 1))}
                  disabled={memberSummaryCurrentPage <= 1}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn-ghost px-3 py-1.5 text-xs"
                  onClick={() =>
                    setMemberSummaryPage((previous) => Math.min(memberSummaryTotalPages, previous + 1))
                  }
                  disabled={memberSummaryCurrentPage >= memberSummaryTotalPages}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>
      </>
      ) : null}

      {attendancePanel === "analytics" ? (
      <section className="analytics-panel reveal">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-[var(--font-heading)] text-lg text-[#23332d]">Analytics Overview</h2>
          {activeLinkedEventId ? (
            <p className="text-sm text-[#5d736a]">
              Showing attendance for{" "}
              <span className="font-semibold text-[#315349]">
                {selectedLinkedEventLabel ?? "the selected linked event"}
              </span>
            </p>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-[#5d736a]">
          The shared Events analytics below renders the interactive attendance timeline. The Event Comparison card still
          respects the Ministry / Attendance Type / Linked Event filters above.
        </p>

        {timelineStatus === "loading" ? (
          <div className="mt-4 status-info">Loading attendance history...</div>
        ) : null}
        {timelineStatus === "error" ? (
          <div className="mt-4 status-error">
            The attendance history could not be loaded. Use Refresh above, then reopen this tab.
          </div>
        ) : null}

        {timelineStatus === "ready" ? (
          <>
            <div className="mt-4">
              <EventsAnalyticsModule />
            </div>

            <div className="card mt-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-[var(--font-heading)] text-lg text-[#24362f]">Event Comparison</h3>
                  <p className="mt-1 text-xs text-[#5d736a]">
                    Select up to 3 events — including the same event from different years (for example Anniversary last
                    year vs this year). Bars use linked attendance when available, otherwise the event date.
                  </p>
                </div>
                {compareEventIds.length > 0 ? (
                  <button
                    type="button"
                    className="btn-ghost px-3 py-1.5 text-xs"
                    onClick={() => setCompareEventIds([])}
                  >
                    Clear selection
                  </button>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {eventsForComparison.map((event) => {
                  const active = compareEventIds.includes(event.id);
                  const disabled = !active && compareEventIds.length >= 3;
                  return (
                    <button
                      key={event.id}
                      type="button"
                      disabled={disabled}
                      className={active ? "btn-primary px-3 py-1.5 text-xs" : "btn-ghost px-3 py-1.5 text-xs"}
                      onClick={() => toggleCompareEvent(event.id)}
                    >
                      {event.title}
                      {event.event_date ? ` · ${formatDateMMDDYY(event.event_date)}` : ""}
                    </button>
                  );
                })}
                {eventsForComparison.length === 0 ? (
                  <p className="text-xs text-[#5d736a]">No events available yet.</p>
                ) : null}
              </div>
              {eventComparisonRows.some((row) => row.matchedBy === "date") ? (
                <p className="text-[11px] text-[#8a5a17]">
                  Note: some events show date-matched attendance (attendance was recorded without linking the event).
                </p>
              ) : null}
            </div>

            <div className="mt-4">
              <GroupedBarsPanel
                title="Selected Events"
                note={eventComparisonRows.length > 0 ? "Check-ins, unique attendees and newcomers per event day." : undefined}
                data={eventComparisonData}
                series={[
                  { key: "Check-Ins", name: "Check-Ins", color: "#0f766e" },
                  { key: "Unique Attendees", name: "Unique Attendees", color: "#2563eb" },
                  { key: "Newcomers", name: "Newcomers", color: "#f59e0b" }
                ]}
                emptyText="Select up to 3 events above to compare their attendance."
              />
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <CategoryBarsPanel title="Attendees by Attendance Type" items={attendanceByContext} emptyText="No attendance type data yet." />
              <CategoryBarsPanel title="Attendees by Linked Event" items={attendanceByLinkedEvent} emptyText="No linked event attendance yet." />
              <CategoryBarsPanel title="Attendees by Service or Event" items={attendanceByGroup} emptyText="No attendance group data yet." />
              <CategoryBarsPanel title="Newcomer Visits by Ministry" items={newcomerByGroup} emptyText="No newcomer attendance yet." />
            </div>
          </>
        ) : null}
      </section>
      ) : null}
      </div>
    </div>
  );
}
