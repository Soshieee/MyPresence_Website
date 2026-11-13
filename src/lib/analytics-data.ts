import { supabase } from "@/lib/supabase";
import type { AttendanceLog } from "@/types";
import type { EventFeedbackSummary } from "@/components/event-feedback";

// ---------------------------------------------------------------------------
// P8 — Simplified analytics (Events / Lifegroup / Members)
// Shared client-side data access for the three analytics modules. The pages
// load data on the client (same pattern as the rest of the dashboard), so
// these helpers keep the queries in one place and degrade gracefully when an
// optional table/view/column is missing in a given deployment.
// ---------------------------------------------------------------------------

/**
 * Reachable analytics history floor. Lowered from 2026-01-01 so pre-2026
 * attendance history (e.g., the 2023 records in the database) stays visible —
 * the same floor the Records page uses, so the shared modules and the Records
 * timeline show the same history and year-over-year comparison works.
 */
export const MIN_ANALYTICS_DATE = "2023-01-01";

const PAGE_SIZE = 1000;
const MAX_PAGES = 30;
const TABLE_LIMIT = 5000;

export type AnalyticsUser = {
  id: string;
  student_id: string;
  full_name: string;
  age: number | null;
  gender: "Male" | "Female" | "Other" | null;
  newcomer: boolean;
  is_active?: boolean | null;
  created_at: string;
};

export type AnalyticsEvent = {
  id: string;
  title: string;
  details: string | null;
  event_date: string | null;
  location: string | null;
  poster_url: string | null;
  event_type: string | null;
};

export type LifegroupRow = {
  id: string;
  name: string;
  description?: string | null;
  leader_id?: string | null;
  status?: string | null;
  created_at?: string | null;
};

export type LifegroupMemberRow = {
  id?: string;
  lifegroup_id: string;
  user_id: string;
  role?: string | null;
  status?: string | null;
  joined_at?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
};

export type ProfileRow = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
};

export type LifegroupActivityRow = {
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

export type LifegroupAttendanceRow = {
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

export type LifegroupAnalyticsData = {
  lifegroups: LifegroupRow[];
  members: LifegroupMemberRow[];
  profiles: ProfileRow[];
  activities: LifegroupActivityRow[];
  attendance: LifegroupAttendanceRow[];
  errors: string[];
};

const ATTENDANCE_COLUMNS =
  "id, student_id, full_name, was_newcomer, attendance_context, attendance_group, service_type, event_id, attended_date, attended_at";
const ATTENDANCE_COLUMNS_LEGACY =
  "id, student_id, full_name, was_newcomer, attendance_context, attendance_group, event_id, attended_date, attended_at";

function isMissingServiceTypeColumnError(message: string) {
  return (
    /column\s+attendance\.service_type\s+does not exist/i.test(message) ||
    /could not find the '?service_type'? column of '?attendance'? in the schema cache/i.test(message)
  );
}

function isMissingColumnError(message: string, column: string) {
  const pattern = new RegExp(`column\\s+\\S+\\.${column}\\s+does not exist`, "i");
  const cachePattern = new RegExp(`could not find the '?${column}'? column`, "i");
  return pattern.test(message) || cachePattern.test(message);
}

/** Full attendance history since MIN_ANALYTICS_DATE, paginated past the 1000-row cap. */
export async function fetchAttendanceHistory(): Promise<AttendanceLog[]> {
  let useServiceType = true;
  const rows: AttendanceLog[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabase
      .from("attendance")
      .select(useServiceType ? ATTENDANCE_COLUMNS : ATTENDANCE_COLUMNS_LEGACY)
      .gte("attended_date", MIN_ANALYTICS_DATE)
      .order("attended_date", { ascending: true })
      .order("attended_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      if (useServiceType && isMissingServiceTypeColumnError(error.message)) {
        useServiceType = false;
        rows.length = 0;
        page -= 1;
        continue;
      }
      throw new Error(error.message);
    }

    const batch = (data ?? []) as unknown as AttendanceLog[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  return rows;
}

/** Member directory with the demographic fields the analytics need. */
export async function fetchAnalyticsUsers(): Promise<AnalyticsUser[]> {
  let includeActive = true;
  const rows: AnalyticsUser[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const base = "id, student_id, full_name, age, gender, newcomer, created_at";
    const { data, error } = await supabase
      .from("users")
      .select(includeActive ? `id, student_id, full_name, age, gender, newcomer, is_active, created_at` : base)
      .order("student_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      if (includeActive && isMissingColumnError(error.message, "is_active")) {
        includeActive = false;
        rows.length = 0;
        page -= 1;
        continue;
      }
      throw new Error(error.message);
    }

    const batch = (data ?? []) as unknown as AnalyticsUser[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  return rows;
}

/** Events with the fields used by the timeline markers and the details panel. */
export async function fetchAnalyticsEvents(): Promise<AnalyticsEvent[]> {
  let includeType = true;
  const rows: AnalyticsEvent[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const base = "id, title, details, event_date, location, poster_url";
    const { data, error } = await supabase
      .from("events")
      .select(includeType ? `${base}, event_type` : base)
      .order("event_date", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      if (includeType && isMissingColumnError(error.message, "event_type")) {
        includeType = false;
        rows.length = 0;
        page -= 1;
        continue;
      }
      throw new Error(error.message);
    }

    const batch = (data ?? []) as unknown as AnalyticsEvent[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  return rows;
}

/**
 * Per-event feedback aggregates from the event_feedback_summary view.
 * Feedback is optional; when the view is unavailable the map is empty and the
 * details panel simply omits the ratings block.
 */
export async function fetchFeedbackSummaries(): Promise<Map<string, EventFeedbackSummary>> {
  const full =
    "event_id, total_responses, avg_overall_rating, avg_food_rating, avg_venue_rating, avg_music_rating, avg_program_rating, avg_staff_rating, avg_speaker_rating, food_responses, venue_responses, music_responses, program_responses, staff_responses, speaker_responses";
  const basic =
    "event_id, total_responses, avg_overall_rating, avg_food_rating, avg_venue_rating, avg_music_rating, avg_program_rating, avg_staff_rating, avg_speaker_rating";

  const first = await supabase.from("event_feedback_summary").select(full).limit(TABLE_LIMIT);
  let raw: EventFeedbackSummary[] = (first.data ?? []) as unknown as EventFeedbackSummary[];
  if (first.error) {
    const fallback = await supabase.from("event_feedback_summary").select(basic).limit(TABLE_LIMIT);
    if (fallback.error) return new Map();
    raw = (fallback.data ?? []) as unknown as EventFeedbackSummary[];
  }

  const map = new Map<string, EventFeedbackSummary>();
  for (const row of raw) {
    if (row?.event_id) map.set(row.event_id, row);
  }
  return map;
}

async function settleTable<T>(
  label: string,
  query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  errors: string[]
): Promise<T[]> {
  try {
    const { data, error } = await query;
    if (error) {
      errors.push(`${label}: ${error.message}`);
      return [];
    }
    return (data ?? []) as T[];
  } catch (err: unknown) {
    errors.push(`${label}: ${err instanceof Error ? err.message : "unavailable"}`);
    return [];
  }
}

/** Lifegroup tables used by the Lifegroup analytics module. */
export async function fetchLifegroupAnalyticsData(): Promise<LifegroupAnalyticsData> {
  const errors: string[] = [];

  const [lifegroups, members, profiles, activities, attendance] = await Promise.all([
    settleTable<LifegroupRow>(
      "lifegroups",
      supabase.from("lifegroups").select("*").order("name", { ascending: true }).limit(TABLE_LIMIT),
      errors
    ),
    settleTable<LifegroupMemberRow>(
      "lifegroup_members",
      supabase.from("lifegroup_members").select("*").limit(TABLE_LIMIT),
      errors
    ),
    settleTable<ProfileRow>(
      "profiles",
      supabase.from("profiles").select("id, first_name, last_name").limit(TABLE_LIMIT),
      errors
    ),
    settleTable<LifegroupActivityRow>(
      "lifegroup_activities",
      supabase.from("lifegroup_activities").select("*").order("starts_at", { ascending: true }).limit(TABLE_LIMIT),
      errors
    ),
    settleTable<LifegroupAttendanceRow>(
      "lifegroup_attendance",
      supabase.from("lifegroup_attendance").select("*").limit(TABLE_LIMIT),
      errors
    )
  ]);

  return { lifegroups, members, profiles, activities, attendance, errors };
}

// ---------------------------------------------------------------------------
// Tolerant field readers (lifegroup schema varies between deployments)
// ---------------------------------------------------------------------------

export function rowString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

export function rowBoolean(row: Record<string, unknown>, keys: string[]): boolean | null {
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

export function toDateKey(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getFullYear();
  const month = `${parsed.getMonth() + 1}`.padStart(2, "0");
  const day = `${parsed.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function lifegroupActivityDate(activity: LifegroupActivityRow | undefined): string | null {
  if (!activity) return null;
  return toDateKey(rowString(activity, ["starts_at", "activity_date", "date", "created_at"]));
}

export function lifegroupAttendanceDate(
  row: LifegroupAttendanceRow,
  activityById: Map<string, LifegroupActivityRow>
): string | null {
  const direct = toDateKey(
    rowString(row, ["attended_at", "checked_in_at", "attendance_date", "date", "recorded_at", "created_at"])
  );
  if (direct) return direct;
  const activity = row.activity_id ? activityById.get(row.activity_id) : undefined;
  return lifegroupActivityDate(activity);
}

export function isPresentAttendance(row: LifegroupAttendanceRow): boolean {
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
      ].includes(status)
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
  return true;
}

export function isActiveMembership(row: LifegroupMemberRow): boolean {
  const status = (row.status ?? "").trim().toLowerCase();
  if (!status) return true;
  return status === "active" || status === "approved";
}

export function profileDisplayName(profile: ProfileRow | undefined, fallback: string): string {
  if (!profile) return fallback;
  const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim();
  return name || fallback;
}

export function formatDayLabel(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatMonthKey(key: string): string {
  const [year, month] = key.split("-").map(Number);
  if (!year || !month) return key;
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
