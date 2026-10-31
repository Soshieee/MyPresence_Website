export const ATTENDANCE_TYPES = [
  "Sunday Service",
  "Prayer Meeting",
  "Rooftop",
  "Women's Network",
  "Men's Network"
] as const;

export type AttendanceType = (typeof ATTENDANCE_TYPES)[number];

export const SUNDAY_SESSIONS = ["First Service", "Second Service"] as const;

export type SundaySession = (typeof SUNDAY_SESSIONS)[number];

export const EVENT_TYPES = [
  "Sunday Service",
  "Rooftop",
  "Women's Network",
  "Men's Network",
  "General"
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const LEGACY_EVENT_CONTEXT = "Events";

export function isAttendanceType(value: unknown): value is AttendanceType {
  return typeof value === "string" && (ATTENDANCE_TYPES as readonly string[]).includes(value);
}

export function isSundaySession(value: unknown): value is SundaySession {
  return typeof value === "string" && (SUNDAY_SESSIONS as readonly string[]).includes(value);
}

export function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && (EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Legacy rows stored Rooftop / Men's Network / Women's Network under the
 * generic "Events" context. Resolve them to the canonical attendance type.
 */
export function normalizeAttendanceType(
  context: string | null,
  group: string | null
): AttendanceType | null {
  if (isAttendanceType(context)) return context;
  if (context === LEGACY_EVENT_CONTEXT) {
    if (group === "Rooftop" || group === "Women's Network" || group === "Men's Network") {
      return group;
    }
  }
  if (context === null) {
    if (group === "Rooftop" || group === "Women's Network" || group === "Men's Network") {
      return group;
    }
  }
  return null;
}

export function attendanceGroupFor(
  type: AttendanceType,
  session?: SundaySession | string | null
): string | null {
  if (type === "Sunday Service") {
    return isSundaySession(session) ? session : null;
  }
  return type;
}

export function compatibleEventTypes(type: AttendanceType): readonly EventType[] {
  switch (type) {
    case "Sunday Service":
      return ["Sunday Service", "General"];
    case "Prayer Meeting":
      return ["General"];
    case "Rooftop":
      return ["Rooftop", "General"];
    case "Women's Network":
      return ["Women's Network", "General"];
    case "Men's Network":
      return ["Men's Network", "General"];
  }
}

export function isEventCompatible(
  type: AttendanceType,
  eventType: string | null | undefined
): eventType is EventType {
  if (!isEventType(eventType)) return false;
  return compatibleEventTypes(type).includes(eventType);
}

export function serviceSessionForLog(log: {
  attendance_context: string | null;
  attendance_group: string | null;
  service_type?: string | null;
}): string {
  if (log.attendance_context !== "Sunday Service") return "N/A";
  if (isSundaySession(log.service_type)) return log.service_type;
  if (isSundaySession(log.attendance_group)) return log.attendance_group;
  return "N/A";
}

export function normalizeServiceType(
  context: string | null,
  serviceType: string | null,
  group: string | null
): SundaySession | null {
  if (context !== "Sunday Service") return null;
  if (isSundaySession(serviceType)) return serviceType;
  if (isSundaySession(group)) return group;
  return null;
}

export type AttendanceDbErrorKind = "duplicate" | "inactive" | "event" | "invalid" | "general";

export const ATTENDANCE_ERROR_MESSAGES = {
  duplicate: "This member has already been scanned for this attendance event.",
  inactive: "This member is currently inactive and cannot be recorded for attendance.",
  eventMismatch: "The selected event is not compatible with this attendance type.",
  eventRequired: "The selected event needs an Event Type before it can be linked.",
  eventMissing: "The selected event no longer exists. Choose another event or leave it blank.",
  invalidType: "Select a valid attendance type before scanning.",
  unregistered: "The user is not registered.",
  saveFailed: "Attendance could not be saved. Please try again."
} as const;

export function describeAttendanceDbError(message: string): {
  kind: AttendanceDbErrorKind;
  message: string;
} | null {
  const normalized = message.toUpperCase();
  const has = (needle: string) => normalized.includes(needle.toUpperCase());

  if (has("MEMBER_INACTIVE")) {
    return { kind: "inactive", message: ATTENDANCE_ERROR_MESSAGES.inactive };
  }

  if (
    has("ATTENDANCE_UNIQUE_SUNDAY_PER_DATE") ||
    has("DUPLICATE_SUNDAY_SERVICE") ||
    has("DUPLICATE_SUNDAY")
  ) {
    return { kind: "duplicate", message: ATTENDANCE_ERROR_MESSAGES.duplicate };
  }

  if (
    has("ATTENDANCE_UNIQUE_PER_SESSION") ||
    has("DUPLICATE KEY") ||
    has("23505") ||
    has("DUPLICATE_ATTENDANCE")
  ) {
    return { kind: "duplicate", message: ATTENDANCE_ERROR_MESSAGES.duplicate };
  }

  if (has("EVENT_TYPE_MISMATCH") || has("ATTENDANCE_EVENT_TYPE_MISMATCH")) {
    return { kind: "event", message: ATTENDANCE_ERROR_MESSAGES.eventMismatch };
  }

  if (has("EVENT_TYPE_REQUIRED")) {
    return { kind: "event", message: ATTENDANCE_ERROR_MESSAGES.eventRequired };
  }

  if (has("EVENT_NOT_FOUND")) {
    return { kind: "event", message: ATTENDANCE_ERROR_MESSAGES.eventMissing };
  }

  if (has("ATTENDANCE_TYPE_INVALID") || has("ATTENDANCE_GROUP_INVALID")) {
    return { kind: "invalid", message: ATTENDANCE_ERROR_MESSAGES.invalidType };
  }

  if (has("MEMBER_NOT_FOUND")) {
    return { kind: "invalid", message: ATTENDANCE_ERROR_MESSAGES.unregistered };
  }

  return null;
}

export function isMissingActiveColumnError(message: string) {
  return (
    /column\s+users\.is_active\s+does not exist/i.test(message) ||
    /could not find the '?is_active'? column of '?users'? in the schema cache/i.test(message) ||
    (/PGRST204/i.test(message) && /is_active/i.test(message))
  );
}

export function isMissingEventTypeColumnError(message: string) {
  return (
    /column\s+events\.event_type\s+does not exist/i.test(message) ||
    /could not find the '?event_type'? column of '?events'? in the schema cache/i.test(message) ||
    (/PGRST204/i.test(message) && /event_type/i.test(message))
  );
}

export function isMissingServiceTypeColumnError(message: string) {
  return (
    /column\s+attendance\.service_type\s+does not exist/i.test(message) ||
    /could not find the '?service_type'? column of '?attendance'? in the schema cache/i.test(message) ||
    (/PGRST204/i.test(message) && /service_type/i.test(message))
  );
}
