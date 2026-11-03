import type { PollStatus } from "@/types";

export type ParsedPollSuggestion = {
  kind: "Q" | "C";
  pollKey: string;
  text: string;
  legacy: boolean;
};

export type PollChoiceDraft = {
  key: string;
  rowId: string | null;
  text: string;
  archivedAt: string | null;
};

export type PollDraft = {
  key: string;
  name: string;
  mainQuestion: string;
  question: string;
  startsAt: string;
  endsAt: string;
  status: PollStatus;
  choices: PollChoiceDraft[];
};

export type PollEffectiveStatus = "scheduled" | "active" | "ended" | "archived";

type PollScheduleLike = {
  status: PollStatus;
  startsAt?: string | null;
  endsAt?: string | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return Boolean(value && UUID_PATTERN.test(value));
}

export function isPollStatus(value: string | null | undefined): value is PollStatus {
  return value === "open" || value === "closed" || value === "archived";
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Convert a datetime-local input value (the browser's local timezone) to the
 * ISO string stored in Supabase. Returns null for blank or invalid values.
 */
export function dateTimeLocalToIso(value: string): string | null {
  const date = parseDate(value);
  return date ? date.toISOString() : null;
}

/**
 * Convert a Supabase timestamptz value to the local datetime-local input value.
 */
export function isoToDateTimeLocal(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return "";

  const pad = (part: number) => String(part).padStart(2, "0");
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  ].join("T");
}

export function formatPollDateTime(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return "";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function getPollEffectiveStatus(
  poll: PollScheduleLike,
  now: Date = new Date()
): PollEffectiveStatus {
  if (poll.status === "archived") return "archived";
  if (poll.status === "closed") return "ended";

  const startsAt = parseDate(poll.startsAt);
  const endsAt = parseDate(poll.endsAt);

  if (startsAt && now.getTime() < startsAt.getTime()) return "scheduled";
  if (endsAt && now.getTime() >= endsAt.getTime()) return "ended";
  return "active";
}

export function pollEffectiveStatusLabel(status: PollEffectiveStatus) {
  if (status === "scheduled") return "Scheduled";
  if (status === "ended") return "Ended";
  if (status === "archived") return "Archived";
  return "Active";
}

export function parsePollSuggestion(value: string): ParsedPollSuggestion | null {
  const match = value.match(/^\[POLL_([QC])(?::([^\]]+))?\]\s+([\s\S]*)$/);
  if (!match) return null;

  const pollKey = match[2]?.trim() || "legacy";
  return {
    kind: match[1] as "Q" | "C",
    pollKey,
    text: match[3].trim(),
    legacy: !match[2]?.trim()
  };
}

export function createPollChoice(text = ""): PollChoiceDraft {
  return {
    key: crypto.randomUUID(),
    rowId: null,
    text,
    archivedAt: null
  };
}

export function createPollDraft(): PollDraft {
  return {
    key: crypto.randomUUID(),
    name: "",
    mainQuestion: "",
    question: "",
    startsAt: "",
    endsAt: "",
    status: "open",
    choices: [createPollChoice(), createPollChoice()]
  };
}

export function validatePollDraft(draft: PollDraft): string | null {
  if (!draft.question.trim()) return "Poll question is required.";

  const choices = draft.choices.map((choice) => choice.text.trim()).filter(Boolean);
  if (choices.length < 2) return "Add at least two poll options.";

  const normalized = choices.map((choice) => choice.toLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    return "Each poll option must be unique.";
  }

  if (draft.startsAt && !parseDate(draft.startsAt)) {
    return "Enter a valid poll start date and time.";
  }

  if (draft.endsAt && !parseDate(draft.endsAt)) {
    return "Enter a valid poll end date and time.";
  }

  const startsAt = parseDate(draft.startsAt);
  const endsAt = parseDate(draft.endsAt);

  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
    return "The poll end time must be later than the start time.";
  }

  return null;
}

export function pollStatusLabel(status: PollStatus) {
  if (status === "closed") return "Voting closed";
  if (status === "archived") return "Archived";
  return "Voting open";
}
