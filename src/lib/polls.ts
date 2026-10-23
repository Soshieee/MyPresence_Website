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
  question: string;
  status: PollStatus;
  choices: PollChoiceDraft[];
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return Boolean(value && UUID_PATTERN.test(value));
}

export function isPollStatus(value: string | null | undefined): value is PollStatus {
  return value === "open" || value === "closed" || value === "archived";
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
    question: "",
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

  return null;
}

export function pollStatusLabel(status: PollStatus) {
  if (status === "closed") return "Voting closed";
  if (status === "archived") return "Archived";
  return "Voting open";
}
