"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import AppNotification, { AppNotificationTone } from "@/components/app-notification";
import CalendarImage from "@/components/calendar-image";
import PollPieChart from "@/components/poll-pie-chart";
import { hasSupabaseEnv, supabase, supabaseEnvIssue } from "@/lib/supabase";
import {
  createPollChoice,
  createPollDraft,
  dateTimeLocalToIso,
  formatPollDateTime,
  getPollEffectiveStatus,
  isPollStatus,
  isUuid,
  isoToDateTimeLocal,
  parsePollSuggestion,
  PollEffectiveStatus,
  pollEffectiveStatusLabel,
  validatePollDraft
} from "@/lib/polls";
import {
  CalendarImageRow,
  EventItem,
  EventPollSubmission,
  EventSuggestion,
  PollStatus,
  SocialHashtag
} from "@/types";
import {
  EVENT_TYPES,
  EventType,
  isEventCompatible,
  isEventType,
  isMissingEventTypeColumnError,
  normalizeAttendanceType
} from "@/lib/attendance";

type EventAttendanceRow = {
  id: string;
  full_name: string;
  student_id: string;
  attended_at: string;
  attendance_group: string | null;
};

type MemberCounts = {
  active: number;
  female: number;
  male: number;
};

type SavedPollChoice = {
  rowId: string;
  text: string;
  archivedAt: string | null;
  sortOrder: number;
};

type SavedPoll = {
  key: string;
  name: string;
  mainQuestion: string;
  hashtagIds: string[];
  question: string;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  status: PollStatus;
  choices: SavedPollChoice[];
  legacyQuestionRowId: string | null;
};

type PollDraftEditorProps = {
  draft: ReturnType<typeof createPollDraft>;
  onChange: (draft: ReturnType<typeof createPollDraft>) => void;
  onRemove: () => void;
  scheduleReady: boolean;
  hashtags: SocialHashtag[];
  removeLabel?: string;
};

const SUGGESTION_COLUMNS =
  "id,event_id,suggestion_text,main_question,suggestion_question_text,poll_name,poll_starts_at,poll_ends_at,created_at,poll_key,item_kind,poll_status,archived_at,sort_order,updated_at";
const SUGGESTION_COLUMNS_WITHOUT_SCHEDULE =
  "id,event_id,suggestion_text,main_question,suggestion_question_text,created_at,poll_key,item_kind,poll_status,archived_at,sort_order,updated_at";
const SUGGESTION_FALLBACK_COLUMNS = "id,event_id,suggestion_text,created_at";
const SUBMISSION_COLUMNS = "event_id,poll_id,question_id,voter_key,created_at,updated_at";
const SUBMISSION_FALLBACK_COLUMNS = "event_id,poll_id,created_at";
const CALENDAR_COLUMNS = "id,calendar_img_url,storage_path,created_at,updated_at";
const CALENDAR_BUCKET = "calendar";
const MAX_CALENDAR_BYTES = 5 * 1024 * 1024;
const ALLOWED_CALENDAR_TYPES = ["image/jpeg", "image/png", "image/webp"];
const DEFAULT_FOOD_SUGGESTIONS = ["Chicken", "Porkchop", "Barbecue"];

function isMissingColumnError(message: string) {
  return /column .* does not exist|Could not find the '.*' column|schema cache/i.test(message);
}

function isMissingEventsTableError(message: string) {
  return /Could not find the table 'public\.events'|relation\s+"?events"?\s+does not exist/i.test(message);
}

function isMissingEventSuggestionsTableError(message: string) {
  return /Could not find the table 'public\.event_suggestions'|relation\s+"?event_suggestions"?\s+does not exist/i.test(message);
}

function isMissingAttendanceEventIdError(message: string) {
  return /column\s+attendance\.event_id\s+does not exist/i.test(message);
}

function formatDeleteEventError(message: string) {
  if (/Could not find the function|function\s+.*delete_event.*does not exist|schema cache/i.test(message)) {
    return "Event deletion is not available yet. Run supabase/patch_2026_10_30_delete_event.sql in the Supabase SQL Editor, then try again.";
  }

  if (/EVENT_HAS_ATTENDANCE/i.test(message)) {
    return "This event still has linked attendance records. Refresh the page and try again.";
  }

  if (/must be signed in/i.test(message) || /42501/.test(message)) {
    return "You must be signed in to delete an event.";
  }

  return `Failed to delete event: ${message}`;
}

function formatEventDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function memberDenominatorFor(eventType: EventType | null, counts: MemberCounts | null) {
  if (!counts) {
    return { count: 0, label: "members" };
  }

  if (eventType === "Women's Network") {
    return { count: counts.female, label: "female members" };
  }

  if (eventType === "Men's Network") {
    return { count: counts.male, label: "male members" };
  }

  return { count: counts.active, label: "active members" };
}

function rowPollKey(row: EventSuggestion) {
  return row.poll_key ?? parsePollSuggestion(row.suggestion_text)?.pollKey ?? "legacy";
}

function rowChoiceText(row: EventSuggestion) {
  return parsePollSuggestion(row.suggestion_text)?.text ?? row.suggestion_text.trim();
}

function isQuestionRow(row: EventSuggestion) {
  return row.item_kind === "question" || parsePollSuggestion(row.suggestion_text)?.kind === "Q";
}

function isChoiceRow(row: EventSuggestion) {
  return row.item_kind === "choice" || parsePollSuggestion(row.suggestion_text)?.kind === "C";
}

function isPollSuggestionRow(row: EventSuggestion) {
  return Boolean(
    row.poll_key ||
      row.item_kind ||
      row.suggestion_question_text ||
      parsePollSuggestion(row.suggestion_text)
  );
}

function buildPolls(rows: EventSuggestion[], eventType: EventType | null, pollHashtagIds: Map<string, string[]>): SavedPoll[] {
  const polls = new Map<string, SavedPoll>();

  for (const row of rows) {
    if (!isPollSuggestionRow(row)) continue;

    const parsed = parsePollSuggestion(row.suggestion_text);
    const key = rowPollKey(row);
    const poll = polls.get(key) ?? {
      key,
      name: eventType ?? "Event",
      mainQuestion: "",
      hashtagIds: pollHashtagIds.get(key) ?? [],
      question: "",
      startsAt: null,
      endsAt: null,
      createdAt: row.created_at,
      status: "open" as PollStatus,
      choices: [],
      legacyQuestionRowId: null
    };

    if (row.created_at && (!poll.createdAt || row.created_at < poll.createdAt)) {
      poll.createdAt = row.created_at;
    }

    const pollName = eventType ?? row.poll_name?.trim() ?? "Event";
    const mainQuestionText = row.main_question?.trim() ?? "";
    const questionText = row.suggestion_question_text?.trim() ?? "";
    const rowStatus = isPollStatus(row.poll_status) ? row.poll_status : null;

    poll.name = pollName;

    if (row.poll_starts_at && !poll.startsAt) {
      poll.startsAt = row.poll_starts_at;
    }

    if (row.poll_ends_at && !poll.endsAt) {
      poll.endsAt = row.poll_ends_at;
    }

    if (mainQuestionText && !poll.mainQuestion) {
      poll.mainQuestion = mainQuestionText;
    }

    if (isQuestionRow(row)) {
      poll.legacyQuestionRowId = row.id;
      if (questionText) {
        poll.question = questionText;
      } else if (parsed?.kind === "Q") {
        poll.question = parsed.text;
      }
      poll.status = rowStatus ?? (row.archived_at ? "archived" : "open");
    } else if (isChoiceRow(row)) {
      if (!poll.question && questionText) {
        poll.question = questionText;
      }
      if (rowStatus && poll.status === "open") {
        poll.status = rowStatus;
      }
      poll.choices.push({
        rowId: row.id,
        text: parsed?.text ?? row.suggestion_text.trim(),
        archivedAt: row.archived_at ?? null,
        sortOrder: row.sort_order ?? poll.choices.length
      });
    }

    polls.set(key, poll);
  }

  return Array.from(polls.values())
    .filter((poll) => poll.question && poll.choices.length > 0)
    .map((poll) => ({
      ...poll,
      choices: [...poll.choices].sort((a, b) => a.sortOrder - b.sortOrder)
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function statusBadgeClass(status: PollEffectiveStatus) {
  if (status === "scheduled") return "border-[#b7c5e8] bg-[#eef3ff] text-[#40548f]";
  if (status === "ended") return "border-[#d8c58e] bg-[#fff8df] text-[#6f5a18]";
  if (status === "archived") return "border-[#c6c9c7] bg-[#f1f3f2] text-[#58635f]";
  return "border-[#9fc6b7] bg-[#e7f4ee] text-[#245142]";
}

function displayHashtag(name: string) {
  return name.startsWith("#") ? name : `#${name}`;
}

function normalizeHashtagInput(value: string): { normalized: string | null; error: string | null } {
  const normalized = value.trim().replace(/^#+/, "").toLowerCase();
  if (!normalized) {
    return { normalized: null, error: "Enter a hashtag first." };
  }
  if (!/^[a-z0-9_][a-z0-9_]{0,49}$/.test(normalized)) {
    return {
      normalized: null,
      error: "Use 1-50 letters, numbers, or underscores. Example: #youth or #sunday_service."
    };
  }
  return { normalized, error: null };
}

function HashtagPicker({
  hashtags,
  selectedIds,
  onChange,
  label = "#Hashtags"
}: {
  hashtags: SocialHashtag[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  label?: string;
}) {
  const [search, setSearch] = useState("");
  const selected = new Set(selectedIds);
  const filtered = hashtags.filter((hashtag) => hashtag.is_active && (
    displayHashtag(hashtag.name).toLowerCase().includes(search.trim().toLowerCase())
  ));

  const toggle = (id: string) => {
    onChange(selected.has(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id]);
  };

  return (
    <div className="mt-3">
      <label className="field-label">{label}</label>
      <input
        className="field-input"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search hashtags"
        aria-label="Search hashtags"
      />
      <div className="mt-2 flex max-h-32 flex-wrap gap-2 overflow-y-auto">
        {filtered.map((hashtag) => (
          <button
            key={hashtag.id}
            type="button"
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
              selected.has(hashtag.id)
                ? "border-[#477c69] bg-[#dceee6] text-[#245142]"
                : "border-[#c4d3ce] bg-white text-[#5e766c]"
            }`}
            onClick={() => toggle(hashtag.id)}
            aria-pressed={selected.has(hashtag.id)}
          >
            {displayHashtag(hashtag.name)}
          </button>
        ))}
        {!filtered.length ? <p className="text-xs text-[#7a8b84]">No hashtags found.</p> : null}
      </div>
    </div>
  );
}

function PollDraftEditor({
  draft,
  onChange,
  onRemove,
  scheduleReady,
  hashtags,
  removeLabel = "Remove poll"
}: PollDraftEditorProps) {
  const updateChoice = (choiceKey: string, text: string) => {
    onChange({
      ...draft,
      choices: draft.choices.map((choice) =>
        choice.key === choiceKey ? { ...choice, text } : choice
      )
    });
  };

  return (
    <section className="border-l-4 border-[#4285f4] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="field-label">Poll label</p>
          <p className="text-sm font-semibold text-[#2f4d43]">Automatically uses the event type.</p>
        </div>
        <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={onRemove}>
          {removeLabel}
        </button>
      </div>

      <div className="mt-3">
        <label className="field-label" htmlFor={`poll-question-${draft.key}`}>
          Poll question
        </label>
        <input
          id={`poll-question-${draft.key}`}
          className="field-input rounded-none border-0 border-b-2 border-[#dadce0] bg-[#f8f9fa] focus:border-[#4285f4] focus:ring-0"
          value={draft.question}
          onChange={(event) => onChange({ ...draft, question: event.target.value })}
          placeholder="Which option would you prefer?"
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="field-label" htmlFor={`poll-starts-${draft.key}`}>
            Starts at (optional)
          </label>
          <input
            id={`poll-starts-${draft.key}`}
            className="field-input rounded-none border-0 border-b-2 border-[#dadce0] bg-[#f8f9fa] focus:border-[#4285f4] focus:ring-0"
            type="datetime-local"
            value={draft.startsAt}
            onChange={(event) => onChange({ ...draft, startsAt: event.target.value })}
            disabled={!scheduleReady}
          />
        </div>
        <div>
          <label className="field-label" htmlFor={`poll-ends-${draft.key}`}>
            Ends at (optional)
          </label>
          <input
            id={`poll-ends-${draft.key}`}
            className="field-input rounded-none border-0 border-b-2 border-[#dadce0] bg-[#f8f9fa] focus:border-[#4285f4] focus:ring-0"
            type="datetime-local"
            value={draft.endsAt}
            onChange={(event) => onChange({ ...draft, endsAt: event.target.value })}
            disabled={!scheduleReady}
          />
        </div>
      </div>
      <p className="mt-1 text-xs text-[#5e766c]">
        Times use this device&apos;s local timezone. Leave the start blank to open the poll immediately. Leave the end
        blank to keep it open until you close it manually.
      </p>
      <HashtagPicker
        hashtags={hashtags}
        selectedIds={draft.hashtagIds}
        onChange={(hashtagIds) => onChange({ ...draft, hashtagIds })}
      />
      {!scheduleReady ? (
        <p className="mt-2 rounded-lg border border-[#e3c98f] bg-[#fdf6e6] px-3 py-2 text-xs font-semibold text-[#7a5a17]">
          Poll schedules need supabase/patch_2026_11_02_poll_name_schedule.sql. Poll labels always use the event type.
        </p>
      ) : null}

      <p className="mt-4 text-xs font-semibold uppercase text-[#5f6368]">Options</p>
      <div className="mt-2 space-y-2">
        {draft.choices.map((choice, choiceIndex) => (
          <div key={choice.key} className="flex items-center gap-3">
            <span aria-hidden="true" className="h-5 w-5 shrink-0 rounded-full border-2 border-[#70757a]" />
            <input
              className="field-input rounded-none border-0 border-b border-[#dadce0] px-1 py-2 focus:border-[#4285f4] focus:ring-0"
              value={choice.text}
              onChange={(event) => updateChoice(choice.key, event.target.value)}
              placeholder={`Option ${choiceIndex + 1}`}
              aria-label={`Option ${choiceIndex + 1}`}
            />
            <button
              type="button"
              className="btn-ghost px-2 py-1 text-xs"
              aria-label={`Remove option ${choiceIndex + 1}`}
              onClick={() =>
                onChange({
                  ...draft,
                  choices: draft.choices.filter((item) => item.key !== choice.key)
                })
              }
            >
              x
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="mt-3 text-sm font-semibold text-[#1a73e8]"
        onClick={() => onChange({ ...draft, choices: [...draft.choices, createPollChoice()] })}
      >
        + Add option
      </button>
    </section>
  );
}

function PollResultCard({
  poll,
  now,
  counts,
  total,
  memberCount,
  memberLabel,
  hashtags,
  onEdit,
  onStatusChange,
  onDelete
}: {
  poll: SavedPoll;
  now: Date;
  counts: Map<string, number>;
  total: number;
  memberCount: number;
  memberLabel: string;
  hashtags: SocialHashtag[];
  onEdit: () => void;
  onStatusChange: (status: PollStatus) => void;
  onDelete: () => void;
}) {
  const effectiveStatus = getPollEffectiveStatus(poll, now);
  const startsAtLabel = formatPollDateTime(poll.startsAt);
  const endsAtLabel = formatPollDateTime(poll.endsAt);
  const activeChoices = poll.choices.filter((choice) => !choice.archivedAt);
  const archivedChoices = poll.choices.filter((choice) => choice.archivedAt);
  const archivedChoicesWithVotes = archivedChoices.filter(
    (choice) => (counts.get(choice.rowId) ?? 0) > 0
  );
  const archivedChoicesWithoutVotes = archivedChoices.filter(
    (choice) => (counts.get(choice.rowId) ?? 0) === 0
  );
  const pieSlices = [
    ...activeChoices.map((choice) => ({
      id: choice.rowId,
      label: choice.text,
      votes: counts.get(choice.rowId) ?? 0
    })),
    ...archivedChoicesWithVotes.map((choice) => ({
      id: choice.rowId,
      label: choice.text,
      votes: counts.get(choice.rowId) ?? 0,
      archived: true
    }))
  ];

  return (
    <article className="rounded-xl border border-[#cbd8d3] bg-white p-4 text-sm text-[#2f4d43]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${statusBadgeClass(effectiveStatus)}`}>
              {pollEffectiveStatusLabel(effectiveStatus)}
            </span>
            <span className="text-xs font-semibold text-[#5f6f68]">
              {total} {total === 1 ? "vote" : "votes"}
            </span>
          </div>
          <p className="mt-2 font-[var(--font-heading)] text-lg text-[#243730]">{poll.name}</p>
          <p className="mt-1 text-xs text-[#5e766c]">
            {startsAtLabel ? `Starts ${startsAtLabel}` : "Starts immediately"}
            {" • "}
            {endsAtLabel ? `Ends ${endsAtLabel}` : "No end time"}
          </p>
          {poll.hashtagIds.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {poll.hashtagIds.map((id) => {
                const hashtag = hashtags.find((item) => item.id === id);
                return hashtag ? (
                  <span key={id} className="rounded-full bg-[#edf5f2] px-2 py-1 text-[10px] font-semibold text-[#406357]">
                    {displayHashtag(hashtag.name)}
                  </span>
                ) : null;
              })}
            </div>
          ) : null}
          <div className="mt-2 space-y-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7a8b84]">Poll question</p>
              <p className="font-semibold text-[#2f4d43]">{poll.question}</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
          {poll.status === "open" ? (
            <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => onStatusChange("closed")}>
              Close voting
            </button>
          ) : null}
          {poll.status === "closed" ? (
            <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => onStatusChange("open")}>
              Reopen
            </button>
          ) : null}
          {poll.status === "archived" ? (
            <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => onStatusChange("open")}>
              Restore
            </button>
          ) : (
            <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => onStatusChange("archived")}>
              Archive
            </button>
          )}
          <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="px-3 py-1 text-xs font-semibold text-[#8a3f46]" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>

      <div className="mt-3">
        {pieSlices.length === 0 ? (
          <p className="text-sm text-[#5e766c]">No active options. Edit this poll to add options.</p>
        ) : (
          <PollPieChart slices={pieSlices} memberCount={memberCount} memberLabel={memberLabel} />
        )}
      </div>

      {archivedChoicesWithoutVotes.length > 0 ? (
        <details className="mt-3 rounded-xl border border-[#d6e1dd] bg-[#f7f9f8] px-3 py-2">
          <summary className="cursor-pointer text-xs font-semibold text-[#5f6f68]">
            Archived options with no votes ({archivedChoicesWithoutVotes.length})
          </summary>
          <div className="mt-2 space-y-1">
            {archivedChoicesWithoutVotes.map((choice) => (
              <div key={choice.rowId} className="flex items-center justify-between gap-3 text-xs text-[#687a73]">
                <span className="line-through">{choice.text}</span>
                <span>{counts.get(choice.rowId) ?? 0} votes</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </article>
  );
}

export default function EventsManagerPage() {
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [eventType, setEventType] = useState<EventType | "">("");
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [newEventPolls, setNewEventPolls] = useState<ReturnType<typeof createPollDraft>[]>([]);
  const [newEventHashtagIds, setNewEventHashtagIds] = useState<string[]>([]);
  const [additionalPolls, setAdditionalPolls] = useState<ReturnType<typeof createPollDraft>[]>([]);
  const [editingPoll, setEditingPoll] = useState<ReturnType<typeof createPollDraft> | null>(null);
  const [showArchivedPolls, setShowArchivedPolls] = useState(false);
  const [location, setLocation] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventSuggestions, setEventSuggestions] = useState<EventSuggestion[]>([]);
  const [hashtags, setHashtags] = useState<SocialHashtag[]>([]);
  const [eventHashtagIds, setEventHashtagIds] = useState<string[]>([]);
  const [pollHashtagRows, setPollHashtagRows] = useState<Array<{ event_id: string; poll_key: string; hashtag_id: string }>>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [suggestionInput, setSuggestionInput] = useState("");
  const [newHashtagInput, setNewHashtagInput] = useState("");
  const [hashtagAdminState, setHashtagAdminState] = useState<"checking" | "allowed" | "denied" | "unknown">("checking");
  const [suggestionStatus, setSuggestionStatus] = useState("");
  const [submissionStatus, setSubmissionStatus] = useState("");
  const [selectedEventAttendance, setSelectedEventAttendance] = useState<EventAttendanceRow[]>([]);
  const [attendanceStatus, setAttendanceStatus] = useState("");
  const [submissions, setSubmissions] = useState<EventPollSubmission[]>([]);
  const [memberCounts, setMemberCounts] = useState<MemberCounts | null>(null);
  const [pollSchemaReady, setPollSchemaReady] = useState(true);
  const [pollScheduleReady, setPollScheduleReady] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [submissionSchemaReady, setSubmissionSchemaReady] = useState(true);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EventItem | null>(null);
  const [deleteAttendanceCount, setDeleteAttendanceCount] = useState<number | null>(null);
  const [deleteStep, setDeleteStep] = useState<"choice" | "confirm-attendance">("choice");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteChecking, setDeleteChecking] = useState(false);
  const [calendarRow, setCalendarRow] = useState<CalendarImageRow | null>(null);
  const [calendarSchemaReady, setCalendarSchemaReady] = useState(true);
  const [calendarFile, setCalendarFile] = useState<File | null>(null);
  const [calendarPreviewUrl, setCalendarPreviewUrl] = useState<string | null>(null);
  const [calendarStatus, setCalendarStatus] = useState("");
  const [calendarStatusIsError, setCalendarStatusIsError] = useState(false);
  const [calendarUploading, setCalendarUploading] = useState(false);
  const [pollDeleteTarget, setPollDeleteTarget] = useState<SavedPoll | null>(null);
  const [notification, setNotification] = useState<{ tone: AppNotificationTone; message: string } | null>(null);
  const [deletingPollKey, setDeletingPollKey] = useState<string | null>(null);

  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? null;
  const memberDenominator = memberDenominatorFor(selectedEvent?.event_type ?? null, memberCounts);

  const selectedEventSuggestions = useMemo(
    () => (selectedEventId ? eventSuggestions.filter((row) => row.event_id === selectedEventId) : []),
    [eventSuggestions, selectedEventId]
  );

  const pollHashtagIds = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of pollHashtagRows) {
      const current = map.get(`${row.event_id}:${row.poll_key}`) ?? [];
      map.set(`${row.event_id}:${row.poll_key}`, [...current, row.hashtag_id]);
    }
    return map;
  }, [pollHashtagRows]);

  const selectedEventPolls = useMemo(
    () => {
      if (!selectedEventId) return [];
      const eventPollHashtags = new Map<string, string[]>();
      for (const [key, ids] of pollHashtagIds) {
        const prefix = `${selectedEventId}:`;
        if (key.startsWith(prefix)) eventPollHashtags.set(key.slice(prefix.length), ids);
      }
      return buildPolls(selectedEventSuggestions, selectedEvent?.event_type ?? null, eventPollHashtags);
    },
    [pollHashtagIds, selectedEvent, selectedEventId, selectedEventSuggestions]
  );

  const selectedEventPlainSuggestions = useMemo(
    () => selectedEventSuggestions.filter((item) => !isPollSuggestionRow(item)),
    [selectedEventSuggestions]
  );

  const activePolls = selectedEventPolls.filter((poll) => poll.status !== "archived");
  const archivedPolls = selectedEventPolls.filter((poll) => poll.status === "archived");

  const voteSummary = useMemo(() => {
    const counts = new Map<string, number>();

    for (const submission of submissions) {
      if (submission.event_id !== selectedEventId) continue;
      counts.set(submission.poll_id, (counts.get(submission.poll_id) ?? 0) + 1);
    }

    return { counts };
  }, [selectedEventId, submissions]);

  const pollVoteTotal = useCallback(
    (poll: SavedPoll) =>
      poll.choices.reduce((total, choice) => total + (voteSummary.counts.get(choice.rowId) ?? 0), 0),
    [voteSummary]
  );

  const loadEvents = useCallback(async () => {
    if (!hasSupabaseEnv) {
      setStatus(supabaseEnvIssue ?? "Missing Supabase config.");
      return;
    }

    const { data, error } = await supabase
      .from("events")
      .select("id, title, details, event_date, location, poster_url, event_type, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      if (isMissingEventsTableError(error.message)) {
        setEvents([]);
        setStatus("Events table is missing. Run supabase/schema.sql in Supabase SQL Editor, then refresh this page.");
        return;
      }

      if (isMissingEventTypeColumnError(error.message)) {
        const fallback = await supabase
          .from("events")
          .select("id, title, details, event_date, location, poster_url, created_at")
          .order("created_at", { ascending: false });

        if (fallback.error) {
          setStatus(`Failed to load events: ${fallback.error.message}`);
          return;
        }

        const fallbackEvents = ((fallback.data ?? []) as Array<Omit<EventItem, "event_type">>).map((row) => ({
          ...row,
          event_type: null
        }));
        setEvents(fallbackEvents);
        if (fallbackEvents.length > 0) {
          setSelectedEventId((previous) => previous ?? fallbackEvents[0].id);
        }
        setStatus("Event type column is missing. Run the attendance migration to enable event categories.");
        return;
      }

      setStatus(`Failed to load events: ${error.message}`);
      return;
    }

    const nextEvents = (data ?? []) as EventItem[];
    setEvents(nextEvents);
    if (nextEvents.length > 0) {
      setSelectedEventId((previous) => previous ?? nextEvents[0].id);
    }
  }, []);

  const loadMemberCounts = useCallback(async () => {
    if (!hasSupabaseEnv) return;

    try {
      const [activeResult, femaleResult, maleResult] = await Promise.all([
        supabase.from("users").select("id", { count: "exact", head: true }).eq("is_active", true),
        supabase
          .from("users")
          .select("id", { count: "exact", head: true })
          .eq("is_active", true)
          .eq("gender", "Female"),
        supabase
          .from("users")
          .select("id", { count: "exact", head: true })
          .eq("is_active", true)
          .eq("gender", "Male")
      ]);

      if (activeResult.error || femaleResult.error || maleResult.error) {
        return;
      }

      setMemberCounts({
        active: activeResult.count ?? 0,
        female: femaleResult.count ?? 0,
        male: maleResult.count ?? 0
      });
    } catch {
      // Leave counts unavailable; poll cards show a dash until they load.
    }
  }, []);

  const loadSuggestions = useCallback(async () => {
    if (!hasSupabaseEnv) return;

    const { data, error } = await supabase
      .from("event_suggestions")
      .select(SUGGESTION_COLUMNS)
      .order("created_at", { ascending: true });

    if (!error) {
      setPollSchemaReady(true);
      setPollScheduleReady(true);
      setEventSuggestions((data ?? []) as EventSuggestion[]);
      return;
    }

    if (isMissingEventSuggestionsTableError(error.message)) {
      setSuggestionStatus("Event suggestions table is missing. Run supabase/schema.sql to enable suggestions.");
      return;
    }

    if (!isMissingColumnError(error.message)) {
      setSuggestionStatus(`Failed to load suggestions: ${error.message}`);
      return;
    }

    const withoutSchedule = await supabase
      .from("event_suggestions")
      .select(SUGGESTION_COLUMNS_WITHOUT_SCHEDULE)
      .order("created_at", { ascending: true });

    if (!withoutSchedule.error) {
      setPollSchemaReady(true);
      setPollScheduleReady(false);
      setEventSuggestions((withoutSchedule.data ?? []) as EventSuggestion[]);
      setSuggestionStatus(
        "Poll scheduling is not enabled yet. Run supabase/patch_2026_11_02_poll_name_schedule.sql in the Supabase SQL Editor."
      );
      return;
    }

    if (!isMissingColumnError(withoutSchedule.error.message)) {
      setSuggestionStatus(`Failed to load suggestions: ${withoutSchedule.error.message}`);
      return;
    }

    setPollSchemaReady(false);
    setPollScheduleReady(false);
    const fallback = await supabase
      .from("event_suggestions")
      .select(SUGGESTION_FALLBACK_COLUMNS)
      .order("created_at", { ascending: true });

    if (fallback.error) {
      setSuggestionStatus(`Failed to load suggestions: ${fallback.error.message}`);
      return;
    }

    setEventSuggestions((fallback.data ?? []) as EventSuggestion[]);
    setSuggestionStatus(
      "Poll editing is not enabled yet. Run supabase/patch_2026_10_22_polls_calendar.sql and supabase/patch_2026_10_24_poll_main_question.sql in Supabase SQL Editor."
    );
  }, []);

  const loadHashtags = useCallback(async () => {
    if (!hasSupabaseEnv) return;

    const [hashtagsResult, eventLinksResult, pollLinksResult] = await Promise.all([
      supabase
        .from("social_hashtags")
        .select("id, name, normalized_name, is_default, is_active, created_at")
        .order("is_default", { ascending: false })
        .order("normalized_name", { ascending: true }),
      supabase.from("event_hashtags").select("event_id, hashtag_id"),
      supabase.from("poll_hashtags").select("event_id, poll_key, hashtag_id")
    ]);

    if (hashtagsResult.error) {
      setNotification({ tone: "error", message: `Failed to load hashtags: ${hashtagsResult.error.message}` });
      return;
    }

    setHashtags((hashtagsResult.data ?? []) as SocialHashtag[]);

    if (eventLinksResult.error || pollLinksResult.error) {
      setEventHashtagIds([]);
      setPollHashtagRows([]);
      setNotification({
        tone: "error",
        message: `Hashtags loaded, but their event/poll links could not be read: ${
          eventLinksResult.error?.message ?? pollLinksResult.error?.message ?? "Unknown error."
        }`
      });
      return;
    }

    setEventHashtagIds(
      selectedEventId
        ? ((eventLinksResult.data ?? []) as Array<{ event_id: string; hashtag_id: string }>)
            .filter((row) => row.event_id === selectedEventId)
            .map((row) => row.hashtag_id)
        : []
    );
    setPollHashtagRows((pollLinksResult.data ?? []) as Array<{ event_id: string; poll_key: string; hashtag_id: string }>);
  }, [selectedEventId]);

  const loadSubmissions = useCallback(async (eventId: string) => {
    if (!hasSupabaseEnv) return;

    const { data, error } = await supabase
      .from("EventPoll_Submissions")
      .select(SUBMISSION_COLUMNS)
      .eq("event_id", eventId)
      .order("created_at", { ascending: false });

    if (error) {
      if (isMissingColumnError(error.message)) {
        setSubmissionSchemaReady(false);
        const fallback = await supabase
          .from("EventPoll_Submissions")
          .select(SUBMISSION_FALLBACK_COLUMNS)
          .eq("event_id", eventId)
          .order("created_at", { ascending: false });

        if (fallback.error) {
          setSubmissions([]);
          setSubmissionStatus(`Failed to load votes: ${fallback.error.message}`);
          return;
        }

        setSubmissions((fallback.data ?? []) as EventPollSubmission[]);
        setSubmissionStatus(
          "Vote details need the new submission columns. Run supabase/patch_2026_10_22_polls_calendar.sql."
        );
        return;
      }

      setSubmissions([]);
      setSubmissionStatus(`Failed to load votes: ${error.message}`);
      return;
    }

    setSubmissionSchemaReady(true);
    setSubmissions((data ?? []) as EventPollSubmission[]);
    setSubmissionStatus("");
  }, []);

  const loadCalendar = useCallback(async () => {
    if (!hasSupabaseEnv) return;

    const { data, error } = await supabase
      .from("calendar")
      .select(CALENDAR_COLUMNS)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (isMissingColumnError(error.message)) {
        setCalendarSchemaReady(false);
        const fallback = await supabase
          .from("calendar")
          .select("created_at")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (fallback.error) {
          setCalendarStatus(`Failed to load calendar: ${fallback.error.message}`);
          setCalendarStatusIsError(true);
          return;
        }

        setCalendarRow(
          fallback.data
            ? {
                id: "",
                calendar_img_url: null,
                storage_path: null,
                created_at: fallback.data.created_at,
                updated_at: null
              }
            : null
        );
        setCalendarStatus(
          "Calendar image storage is not enabled yet. Run supabase/patch_2026_10_22_polls_calendar.sql."
        );
        setCalendarStatusIsError(true);
        return;
      }

      setCalendarStatus(`Failed to load calendar: ${error.message}`);
      setCalendarStatusIsError(true);
      return;
    }

    setCalendarSchemaReady(true);
    setCalendarRow((data ?? null) as CalendarImageRow | null);
    setCalendarStatus("");
    setCalendarStatusIsError(false);
  }, []);

  const loadEventAttendance = useCallback(async (eventId: string) => {
    const { data, error } = await supabase
      .from("attendance")
      .select("id, full_name, student_id, attended_at, attendance_group")
      .eq("event_id", eventId)
      .order("attended_at", { ascending: false })
      .limit(40);

    if (error) {
      if (isMissingAttendanceEventIdError(error.message)) {
        setSelectedEventAttendance([]);
        setAttendanceStatus("Run supabase/schema.sql or patch_2026_03_29.sql to enable event-linked attendance.");
        return;
      }

      setAttendanceStatus(`Failed to load event attendance: ${error.message}`);
      return;
    }

    setSelectedEventAttendance((data ?? []) as EventAttendanceRow[]);
    setAttendanceStatus("");
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadEvents();
      void loadMemberCounts();
      void loadSuggestions();
      void loadHashtags();
      void loadCalendar();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadCalendar, loadEvents, loadHashtags, loadMemberCounts, loadSuggestions]);

  useEffect(() => {
    if (!hasSupabaseEnv) {
      setHashtagAdminState("denied");
      return;
    }

    let active = true;
    const checkHashtagAdmin = async () => {
      const socialAdmin = await supabase.rpc("is_social_admin");
      if (!active) return;
      if (!socialAdmin.error) {
        setHashtagAdminState(socialAdmin.data === true ? "allowed" : "denied");
        return;
      }

      const admin = await supabase.rpc("is_admin");
      if (!active) return;
      if (!admin.error) {
        setHashtagAdminState(admin.data === true ? "allowed" : "denied");
        return;
      }

      // Neither helper is available. Let the insert attempt run so the
      // database remains the authority and its error is shown to the user.
      setHashtagAdminState("unknown");
    };

    void checkHashtagAdmin();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setEditingPoll(null);
      setAdditionalPolls([]);
      setShowArchivedPolls(false);

      if (!selectedEventId) {
        setSelectedEventAttendance([]);
        setSubmissions([]);
        return;
      }

      void loadEventAttendance(selectedEventId);
      void loadSubmissions(selectedEventId);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadEventAttendance, loadSubmissions, selectedEventId]);

  useEffect(() => {
    return () => {
      if (calendarPreviewUrl) {
        URL.revokeObjectURL(calendarPreviewUrl);
      }
    };
  }, [calendarPreviewUrl]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(intervalId);
  }, []);

  const addSuggestion = async (eventId: string, rawValue: string) => {
    const next = rawValue.trim();
    if (!next) return;

    const duplicate = eventSuggestions.some(
      (item) => item.event_id === eventId && item.suggestion_text.toLowerCase() === next.toLowerCase()
    );

    if (duplicate) {
      setSuggestionStatus("Suggestion already exists for this event.");
      return;
    }

    const { data, error } = await supabase
      .from("event_suggestions")
      .insert({ event_id: eventId, suggestion_text: next })
      .select(SUGGESTION_FALLBACK_COLUMNS)
      .single();

    if (error) {
      setSuggestionStatus(`Failed to add suggestion: ${error.message}`);
      return;
    }

    setEventSuggestions((previous) => [...previous, data as EventSuggestion]);
    setSuggestionInput("");
    setSuggestionStatus("Suggestion added.");
  };

  const addHashtag = async () => {
    if (hashtagAdminState === "denied") {
      setNotification({
        tone: "warning",
        message: "Only social administrators can create hashtags. You can still select existing hashtags."
      });
      return;
    }

    const { normalized, error: validationError } = normalizeHashtagInput(newHashtagInput);
    if (!normalized) {
      setNotification({ tone: "warning", message: validationError ?? "Enter a valid hashtag." });
      return;
    }

    const duplicate = hashtags.some((hashtag) => {
      const existing = hashtag.normalized_name || normalizeHashtagInput(hashtag.name).normalized;
      return existing === normalized;
    });
    if (duplicate) {
      setNotification({ tone: "warning", message: `#${normalized} already exists.` });
      return;
    }

    try {
      const { data, error } = await supabase
        .from("social_hashtags")
        .insert({
          name: normalized,
          normalized_name: normalized,
          is_default: false,
          is_active: true
        })
        .select("id, name, normalized_name, is_default, is_active, created_at")
        .single();

      if (error) {
        if (error.code === "23505") {
          setNotification({ tone: "warning", message: `#${normalized} already exists.` });
        } else if (error.code === "42501" || /row-level security|permission denied/i.test(error.message)) {
          setNotification({
            tone: "error",
            message:
              "Your account can view hashtags but cannot create them. Ask a social administrator to grant hashtag management access."
          });
        } else if (error.code === "23502" || error.code === "23514" || error.message.includes("INVALID_HASHTAG_FORMAT")) {
          setNotification({
            tone: "error",
            message: "The database rejected that hashtag format. Use 1-50 letters, numbers, or underscores."
          });
        } else {
          setNotification({ tone: "error", message: `Failed to create hashtag: ${error.message}` });
        }
        return;
      }

      const saved = data as SocialHashtag;
      setHashtags((previous) =>
        [...previous.filter((item) => item.id !== saved.id), saved].sort((a, b) =>
          a.normalized_name.localeCompare(b.normalized_name)
        )
      );
      setNewHashtagInput("");
      setNotification({ tone: "success", message: `${displayHashtag(saved.name)} was created.` });
    } catch (error) {
      setNotification({
        tone: "error",
        message: `Failed to create hashtag: ${error instanceof Error ? error.message : "Unknown error."}`
      });
    }
  };

  const saveEventHashtags = async (eventId: string, hashtagIds: string[]) => {
    const desiredIds = [...new Set(hashtagIds)];
    const { data: existingRows, error: readError } = await supabase
      .from("event_hashtags")
      .select("hashtag_id")
      .eq("event_id", eventId);
    if (readError) return readError;

    const existingIds = new Set((existingRows ?? []).map((row) => String(row.hashtag_id)));
    const desiredSet = new Set(desiredIds);
    const toAdd = desiredIds.filter((id) => !existingIds.has(id));
    const toRemove = Array.from(existingIds).filter((id) => !desiredSet.has(id));

    // Add first so an interrupted save never drops an existing association.
    if (toAdd.length) {
      const { error } = await supabase.from("event_hashtags").upsert(
        toAdd.map((hashtag_id) => ({ event_id: eventId, hashtag_id })),
        { onConflict: "event_id,hashtag_id", ignoreDuplicates: true }
      );
      if (error) return error;
    }

    if (toRemove.length) {
      const { error } = await supabase
        .from("event_hashtags")
        .delete()
        .eq("event_id", eventId)
        .in("hashtag_id", toRemove);
      if (error) return error;
    }

    return null;
  };

  const savePollHashtags = async (eventId: string, pollKey: string, hashtagIds: string[]) => {
    const desiredIds = [...new Set(hashtagIds)];
    const { data: existingRows, error: readError } = await supabase
      .from("poll_hashtags")
      .select("hashtag_id")
      .eq("event_id", eventId)
      .eq("poll_key", pollKey);
    if (readError) return readError;

    const existingIds = new Set((existingRows ?? []).map((row) => String(row.hashtag_id)));
    const desiredSet = new Set(desiredIds);
    const toAdd = desiredIds.filter((id) => !existingIds.has(id));
    const toRemove = Array.from(existingIds).filter((id) => !desiredSet.has(id));

    // Add first so an interrupted save never drops an existing association.
    if (toAdd.length) {
      const { error } = await supabase.from("poll_hashtags").upsert(
        toAdd.map((hashtag_id) => ({ event_id: eventId, poll_key: pollKey, hashtag_id })),
        { onConflict: "event_id,poll_key,hashtag_id", ignoreDuplicates: true }
      );
      if (error) return error;
    }

    if (toRemove.length) {
      const { error } = await supabase
        .from("poll_hashtags")
        .delete()
        .eq("event_id", eventId)
        .eq("poll_key", pollKey)
        .in("hashtag_id", toRemove);
      if (error) return error;
    }

    return null;
  };

  const ensureEventHashtags = async (eventId: string, hashtagIds: string[]) => {
    if (!hashtagIds.length) return null;
    const { error } = await supabase.from("event_hashtags").upsert(
      [...new Set(hashtagIds)].map((hashtag_id) => ({ event_id: eventId, hashtag_id })),
      { onConflict: "event_id,hashtag_id", ignoreDuplicates: true }
    );
    return error;
  };

  const removeSuggestion = async (suggestionId: string) => {
    const { error } = await supabase.from("event_suggestions").delete().eq("id", suggestionId);
    if (error) {
      setSuggestionStatus(`Failed to remove suggestion: ${error.message}`);
      return;
    }

    setEventSuggestions((previous) => previous.filter((item) => item.id !== suggestionId));
    setSuggestionStatus("Suggestion removed.");
  };

  const savePoll = async (
    eventId: string,
    draft: ReturnType<typeof createPollDraft>
  ): Promise<boolean> => {
    const validationError = validatePollDraft(draft);
    if (validationError) {
      setSuggestionStatus(validationError);
      return false;
    }

    if (!pollSchemaReady) {
      setSuggestionStatus(
        "Poll editing is not enabled yet. Run supabase/patch_2026_10_22_polls_calendar.sql and supabase/patch_2026_10_24_poll_main_question.sql first."
      );
      return false;
    }

    const pollKey = isUuid(draft.key) ? draft.key : crypto.randomUUID();
    const question = draft.question.trim();
    const choices = draft.choices
      .map((choice) => ({ ...choice, text: choice.text.trim() }))
      .filter((choice) => choice.text.length > 0);
    const now = new Date().toISOString();
    const pollAlreadyExists = eventSuggestions.some(
      (row) => row.event_id === eventId && rowPollKey(row) === draft.key
    );
    const schedulePayload = pollScheduleReady
      ? {
          poll_starts_at: dateTimeLocalToIso(draft.startsAt),
          poll_ends_at: dateTimeLocalToIso(draft.endsAt)
        }
      : {};

    const fail = async (message: string) => {
      setSuggestionStatus(message);
      await loadSuggestions();
      return false;
    };

    if (!pollAlreadyExists) {
      const rows = choices.map((choice, index) => ({
        event_id: eventId,
        suggestion_text: choice.text,
        main_question: null,
        suggestion_question_text: question,
        ...schedulePayload,
        poll_key: pollKey,
        item_kind: "choice",
        poll_status: draft.status,
        archived_at: null,
        sort_order: index,
        updated_at: now
      }));

      const { error } = await supabase.from("event_suggestions").insert(rows);

      if (error) {
        return fail(`Failed to save poll: ${error.message}`);
      }

      const hashtagError = await savePollHashtags(eventId, pollKey, draft.hashtagIds);
      if (hashtagError) return fail(`Failed to save poll hashtags: ${hashtagError.message}`);
      const eventHashtagError = await ensureEventHashtags(eventId, draft.hashtagIds);
      if (eventHashtagError) return fail(`Failed to associate poll hashtags with the event: ${eventHashtagError.message}`);
      await loadSuggestions();
      await loadHashtags();
      setSuggestionStatus("Poll saved.");
      return true;
    }

    const existingChoices = eventSuggestions.filter(
      (row) => row.event_id === eventId && rowPollKey(row) === draft.key && isChoiceRow(row)
    );
    const legacyQuestionRows = eventSuggestions.filter(
      (row) => row.event_id === eventId && rowPollKey(row) === draft.key && isQuestionRow(row)
    );
    const keepRowIds = new Set<string>();

    for (let index = 0; index < choices.length; index += 1) {
      const choice = choices[index];
      const choicePayload = {
        suggestion_text: choice.text,
        main_question: null,
        suggestion_question_text: question,
        ...schedulePayload,
        poll_key: pollKey,
        item_kind: "choice",
        poll_status: draft.status,
        archived_at: null,
        sort_order: index,
        updated_at: now
      };

      if (choice.rowId) {
        const updateResult = await supabase
          .from("event_suggestions")
          .update(choicePayload)
          .eq("id", choice.rowId);

        if (updateResult.error) {
          return fail(`Failed to update a poll option: ${updateResult.error.message}`);
        }

        keepRowIds.add(choice.rowId);
        continue;
      }

      const reusableRow = existingChoices.find((row) => {
        if (keepRowIds.has(row.id)) return false;
        return rowChoiceText(row).toLowerCase() === choice.text.toLowerCase();
      });

      if (reusableRow) {
        const reuseResult = await supabase
          .from("event_suggestions")
          .update(choicePayload)
          .eq("id", reusableRow.id);

        if (reuseResult.error) {
          return fail(`Failed to restore a poll option: ${reuseResult.error.message}`);
        }

        keepRowIds.add(reusableRow.id);
        continue;
      }

      const insertResult = await supabase
        .from("event_suggestions")
        .insert({
          event_id: eventId,
          ...choicePayload
        })
        .select("id")
        .single();

      if (insertResult.error) {
        return fail(`Failed to add a poll option: ${insertResult.error.message}`);
      }

      keepRowIds.add((insertResult.data as { id: string }).id);
    }

    const rowIdsToArchive = existingChoices
      .filter((row) => !keepRowIds.has(row.id))
      .map((row) => row.id);

    if (rowIdsToArchive.length > 0) {
      const archiveResult = await supabase
        .from("event_suggestions")
        .update({
          main_question: null,
          suggestion_question_text: question,
          ...schedulePayload,
          poll_status: draft.status,
          archived_at: now,
          updated_at: now
        })
        .in("id", rowIdsToArchive);

      if (archiveResult.error) {
        return fail(`Failed to archive removed options: ${archiveResult.error.message}`);
      }
    }

    let keptLegacyQuestion = false;
    for (const questionRow of legacyQuestionRows) {
      const hasVotes = submissions.some((submission) => submission.question_id === questionRow.id);
      if (hasVotes) {
        const questionUpdate = await supabase
          .from("event_suggestions")
          .update({
            main_question: null,
            suggestion_question_text: question,
            ...schedulePayload,
            poll_status: draft.status,
            updated_at: now
          })
          .eq("id", questionRow.id);

        if (questionUpdate.error) {
          return fail(`Failed to update the old poll question row: ${questionUpdate.error.message}`);
        }

        keptLegacyQuestion = true;
        continue;
      }

      const deleteResult = await supabase
        .from("event_suggestions")
        .delete()
        .eq("id", questionRow.id);

      if (deleteResult.error) {
        return fail(`Failed to clean up the old poll question row: ${deleteResult.error.message}`);
      }
    }

    await Promise.all([loadSuggestions(), loadSubmissions(eventId)]);
    const hashtagError = await savePollHashtags(eventId, pollKey, draft.hashtagIds);
    if (hashtagError) return fail(`Failed to save poll hashtags: ${hashtagError.message}`);
    const eventHashtagError = await ensureEventHashtags(eventId, draft.hashtagIds);
    if (eventHashtagError) return fail(`Failed to associate poll hashtags with the event: ${eventHashtagError.message}`);
    await loadHashtags();
    setSuggestionStatus(
      keptLegacyQuestion
        ? "Poll updated. A legacy question row with existing votes was kept so no votes were lost."
        : "Poll updated."
    );
    return true;
  };

  const changePollStatus = async (poll: SavedPoll, nextStatus: PollStatus) => {
    if (!pollSchemaReady) {
      setSuggestionStatus(
        "Poll status is not enabled yet. Run supabase/patch_2026_10_22_polls_calendar.sql and supabase/patch_2026_10_24_poll_main_question.sql first."
      );
      return;
    }

    const now = new Date().toISOString();
    const rowIds = [
      ...poll.choices.map((choice) => choice.rowId),
      ...(poll.legacyQuestionRowId ? [poll.legacyQuestionRowId] : [])
    ];
    const { error } = await supabase
      .from("event_suggestions")
      .update({
        poll_status: nextStatus,
        updated_at: now
      })
      .in("id", rowIds);

    if (error) {
      setSuggestionStatus(`Failed to update poll status: ${error.message}`);
      return;
    }

    await loadSuggestions();
    setSuggestionStatus(
      nextStatus === "open"
        ? "Poll reopened. Its schedule and end time still determine when voting is available."
        : nextStatus === "closed"
          ? "Poll closed."
          : "Poll archived."
    );
  };

  const requestDeletePoll = (poll: SavedPoll) => setPollDeleteTarget(poll);

  const deletePoll = async (poll: SavedPoll) => {
    const pollLabel = poll.name || poll.question;
    if (deletingPollKey) return;
    setDeletingPollKey(poll.key);

    const choiceIds = poll.choices.map((choice) => choice.rowId);
    const rowIds = [...choiceIds, ...(poll.legacyQuestionRowId ? [poll.legacyQuestionRowId] : [])];

    if (submissionSchemaReady) {
      if (poll.legacyQuestionRowId) {
        await supabase
          .from("EventPoll_Submissions")
          .delete()
          .eq("question_id", poll.legacyQuestionRowId);
      }

      if (isUuid(poll.key)) {
        await supabase
          .from("EventPoll_Submissions")
          .delete()
          .eq("question_id", poll.key);
      }
    }

    if (choiceIds.length > 0) {
      await supabase
        .from("EventPoll_Submissions")
        .delete()
        .in("poll_id", choiceIds);
    }

    if (selectedEventId && isUuid(poll.key)) {
      const { error: hashtagError } = await supabase
        .from("poll_hashtags")
        .delete()
        .eq("event_id", selectedEventId)
        .eq("poll_key", poll.key);
      if (hashtagError) {
        setNotification({ tone: "error", message: `Failed to delete poll hashtags: ${hashtagError.message}` });
        setDeletingPollKey(null);
        return;
      }
    }

    const { error } = await supabase
      .from("event_suggestions")
      .delete()
      .in("id", rowIds);

    if (error) {
      setNotification({ tone: "error", message: `Failed to delete poll: ${error.message}` });
      setDeletingPollKey(null);
      return;
    }

    if (editingPoll?.key === poll.key) {
      setEditingPoll(null);
    }

    await Promise.all([
      loadSuggestions(),
      selectedEventId ? loadSubmissions(selectedEventId) : Promise.resolve()
    ]);
    setDeletingPollKey(null);
    setPollDeleteTarget(null);
    setNotification({ tone: "success", message: `"${pollLabel}" was deleted successfully.` });
  };

  const startEditingPoll = (poll: SavedPoll) => {
    setEditingPoll({
      key: poll.key,
      name: poll.name,
      mainQuestion: poll.mainQuestion,
      hashtagIds: poll.hashtagIds,
      question: poll.question,
      startsAt: isoToDateTimeLocal(poll.startsAt),
      endsAt: isoToDateTimeLocal(poll.endsAt),
      status: poll.status,
      choices: poll.choices
        .filter((choice) => !choice.archivedAt)
        .map((choice) => ({
          key: choice.rowId,
          rowId: choice.rowId,
          text: choice.text,
          archivedAt: choice.archivedAt
        }))
    });
  };

  const beginDeleteEvent = async (eventId: string) => {
    const eventToDelete = events.find((item) => item.id === eventId);
    if (!eventToDelete) return;

    setDeleteTarget(eventToDelete);
    setDeleteStep("choice");
    setDeleteError(null);
    setDeleteAttendanceCount(null);
    setDeleteChecking(true);

    try {
      const { count, error } = await supabase
        .from("attendance")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eventId);

      if (error && !isMissingAttendanceEventIdError(error.message)) {
        setDeleteError(`Failed to check linked attendance: ${error.message}`);
        return;
      }

      setDeleteAttendanceCount(count ?? 0);
    } catch (error) {
      setDeleteError(
        `Failed to check linked attendance: ${error instanceof Error ? error.message : "Unknown error."}`
      );
    } finally {
      setDeleteChecking(false);
    }
  };

  const closeDeleteModal = () => {
    if (deletingEventId) return;

    setDeleteTarget(null);
    setDeleteStep("choice");
    setDeleteAttendanceCount(null);
    setDeleteError(null);
    setDeleteChecking(false);
  };

  const runDeleteEvent = async (attendanceMode: "keep" | "delete") => {
    if (!deleteTarget) return;

    const target = deleteTarget;
    setDeleteError(null);
    setDeletingEventId(target.id);

    try {
      const { data, error } = await supabase.rpc("delete_event", {
        p_event_id: target.id,
        p_attendance_mode: attendanceMode
      });

      if (error) {
        setDeleteError(formatDeleteEventError(error.message));
        return;
      }

      const result = (data ?? null) as { attendance_count?: number } | null;
      const attendanceCount = result?.attendance_count ?? deleteAttendanceCount ?? 0;

      const remainingEvents = events.filter((item) => item.id !== target.id);
      setEvents(remainingEvents);
      setSelectedEventId((current) => current === target.id ? remainingEvents[0]?.id ?? null : current);
      setEventSuggestions((previous) => previous.filter((item) => item.event_id !== target.id));
      setSubmissions((previous) => previous.filter((item) => item.event_id !== target.id));
      if (editingEventId === target.id) resetEventForm();

      setDeleteTarget(null);
      setDeleteStep("choice");
      setDeleteAttendanceCount(null);
      setStatus(
        attendanceMode === "delete"
          ? `"${target.title}" and ${attendanceCount} attendance record(s) were deleted.`
          : attendanceCount > 0
            ? `"${target.title}" was deleted; ${attendanceCount} attendance record(s) were kept.`
            : `"${target.title}" was deleted.`
      );
    } catch (error) {
      setDeleteError(
        formatDeleteEventError(error instanceof Error ? error.message : "Unknown error.")
      );
    } finally {
      setDeletingEventId(null);
    }
  };

  const onPosterChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setPosterUrl(null);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : null;
      setPosterUrl(value);
    };
    reader.readAsDataURL(file);
  };

  const onCalendarFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setCalendarFile(null);
      setCalendarPreviewUrl(null);
      return;
    }

    if (!ALLOWED_CALENDAR_TYPES.includes(file.type)) {
      setCalendarStatus("Choose a JPEG, PNG, or WebP image.");
      setCalendarStatusIsError(true);
      setCalendarFile(null);
      setCalendarPreviewUrl(null);
      return;
    }

    if (file.size > MAX_CALENDAR_BYTES) {
      setCalendarStatus("Calendar images must be 5 MB or smaller.");
      setCalendarStatusIsError(true);
      setCalendarFile(null);
      setCalendarPreviewUrl(null);
      return;
    }

    setCalendarFile(file);
    setCalendarPreviewUrl(URL.createObjectURL(file));
    setCalendarStatus("");
    setCalendarStatusIsError(false);
  };

  const uploadCalendarImage = async () => {
    if (!calendarFile) return;
    if (!calendarSchemaReady) {
      setCalendarStatus("Run supabase/patch_2026_10_22_polls_calendar.sql before uploading a calendar image.");
      setCalendarStatusIsError(true);
      return;
    }

    setCalendarUploading(true);
    setCalendarStatus("");
    setCalendarStatusIsError(false);

    const file = calendarFile;
    const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const storagePath = `current-${Date.now()}-${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from(CALENDAR_BUCKET)
      .upload(storagePath, file, {
        cacheControl: "3600",
        contentType: file.type,
        upsert: false
      });

    if (uploadError) {
      setCalendarUploading(false);
      setCalendarStatus(`Failed to upload calendar image: ${uploadError.message}`);
      setCalendarStatusIsError(true);
      return;
    }

    const { data: publicUrlData } = supabase.storage
      .from(CALENDAR_BUCKET)
      .getPublicUrl(storagePath);
    const imageUrl = publicUrlData.publicUrl;
    const now = new Date().toISOString();
    const oldStoragePath = calendarRow?.storage_path ?? null;

    const saveResult = calendarRow?.id
      ? await supabase
          .from("calendar")
          .update({ calendar_img_url: imageUrl, storage_path: storagePath, updated_at: now })
          .eq("id", calendarRow.id)
      : await supabase
          .from("calendar")
          .insert({ calendar_img_url: imageUrl, storage_path: storagePath, updated_at: now });

    if (saveResult.error) {
      await supabase.storage.from(CALENDAR_BUCKET).remove([storagePath]);
      setCalendarUploading(false);
      setCalendarStatus(`Failed to save calendar image: ${saveResult.error.message}`);
      setCalendarStatusIsError(true);
      return;
    }

    if (oldStoragePath && oldStoragePath !== storagePath) {
      await supabase.storage.from(CALENDAR_BUCKET).remove([oldStoragePath]);
    }

    setCalendarUploading(false);
    setCalendarFile(null);
    setCalendarPreviewUrl(null);
    await loadCalendar();
    setCalendarStatus("Calendar image saved. It is now visible on the Events page and to the app.");
    setCalendarStatusIsError(false);
  };

  const removeCalendarImage = async () => {
    if (!calendarRow?.id) {
      setCalendarStatus("Calendar image storage is not enabled yet. Run the patch first.");
      setCalendarStatusIsError(true);
      return;
    }

    if (!window.confirm("Remove the current calendar image?")) return;

    const oldStoragePath = calendarRow.storage_path;
    const { error } = await supabase
      .from("calendar")
      .update({ calendar_img_url: null, storage_path: null, updated_at: new Date().toISOString() })
      .eq("id", calendarRow.id);

    if (error) {
      setCalendarStatus(`Failed to remove calendar image: ${error.message}`);
      setCalendarStatusIsError(true);
      return;
    }

    if (oldStoragePath) {
      await supabase.storage.from(CALENDAR_BUCKET).remove([oldStoragePath]);
    }

    await loadCalendar();
    setCalendarStatus("Calendar image removed.");
    setCalendarStatusIsError(false);
  };

  const resetEventForm = () => {
    setTitle("");
    setDetails("");
    setEventType("");
    setEditingEventId(null);
    setNewEventPolls([]);
    setNewEventHashtagIds([]);
    setLocation("");
    setEventDate("");
    setPosterUrl(null);
  };

  const startEditingEvent = async (item: EventItem) => {
    setEditingEventId(item.id);
    setTitle(item.title);
    setDetails(item.details ?? "");
    setLocation(item.location ?? "");
    setEventDate(item.event_date ?? "");
    setPosterUrl(item.poster_url);
    setEventType(item.event_type ?? "");
    setNewEventPolls([]);
    const { data: linkedHashtags, error } = await supabase
      .from("event_hashtags")
      .select("hashtag_id")
      .eq("event_id", item.id);
    if (!error) {
      setNewEventHashtagIds((linkedHashtags ?? []).map((row) => String(row.hashtag_id)));
    } else {
      setNewEventHashtagIds(eventHashtagIds);
    }
    setSelectedEventId(item.id);
    setStatus(
      item.event_type
        ? `Editing "${item.title}".`
        : `Editing "${item.title}". Select an Event Type to complete the classification.`
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!hasSupabaseEnv) {
      setStatus(supabaseEnvIssue ?? "Missing Supabase config.");
      return;
    }

    if (!title.trim()) {
      setStatus("Event title is required.");
      return;
    }

    if (!isEventType(eventType)) {
      setStatus("Event Type is required. Choose one of the five event categories.");
      return;
    }

    for (const poll of newEventPolls) {
      const validationError = validatePollDraft(poll);
      if (validationError) {
        setStatus(validationError);
        return;
      }
    }

    if (editingEventId) {
      const originalEvent = events.find((item) => item.id === editingEventId);

      if (!originalEvent) {
        setStatus("This event no longer exists. Refresh the page and try again.");
        return;
      }

      if (originalEvent.event_type !== eventType) {
        const { data: linkedRows, error: linkedError } = await supabase
          .from("attendance")
          .select("attendance_context, attendance_group")
          .eq("event_id", editingEventId);

        if (linkedError) {
          setStatus(`Failed to validate linked attendance: ${linkedError.message}`);
          return;
        }

        const incompatible = ((linkedRows ?? []) as Array<{
          attendance_context: string | null;
          attendance_group: string | null;
        }>).filter((row) => {
          const linkedType = normalizeAttendanceType(row.attendance_context, row.attendance_group);
          return !linkedType || !isEventCompatible(linkedType, eventType);
        });

        if (incompatible.length > 0) {
          setStatus(
            `Cannot change Event Type: ${incompatible.length} linked attendance record(s) use a different attendance type. Create a new event instead.`
          );
          return;
        }
      }

      setLoading(true);
      const { error } = await supabase
        .from("events")
        .update({
          title: title.trim(),
          details: details.trim() || null,
          location: location.trim() || null,
          event_date: eventDate || null,
          poster_url: posterUrl,
          event_type: eventType
        })
        .eq("id", editingEventId);
      setLoading(false);

      if (error) {
        if (isMissingEventTypeColumnError(error.message)) {
          setStatus("Event Type is not available yet. Run the attendance migration in Supabase SQL Editor first.");
          return;
        }

        setStatus(`Failed to update event: ${error.message}`);
        return;
      }

      const hashtagError = await saveEventHashtags(editingEventId, newEventHashtagIds);
      if (hashtagError) {
        setStatus(`Event updated, but hashtags could not be saved: ${hashtagError.message}`);
        return;
      }

      resetEventForm();
      await loadEvents();
      await loadHashtags();
      setStatus("Event updated successfully.");
      return;
    }

    setLoading(true);
    const { data: createdEvent, error } = await supabase.from("events").insert({
      title: title.trim(),
      details: details.trim() || null,
      location: location.trim() || null,
      event_date: eventDate || null,
      poster_url: posterUrl,
      event_type: eventType
    }).select("id").single();
    setLoading(false);

    if (error) {
      if (isMissingEventsTableError(error.message)) {
        setStatus("Cannot save event yet. Run supabase/schema.sql in Supabase SQL Editor first.");
        return;
      }

      if (isMissingEventTypeColumnError(error.message)) {
        setStatus("Event Type is not available yet. Run the attendance migration in Supabase SQL Editor first.");
        return;
      }

      setStatus(`Failed to save event: ${error.message}`);
      return;
    }

    const hashtagError = await saveEventHashtags(createdEvent.id, newEventHashtagIds);
    if (hashtagError) {
      setStatus(`Event saved, but hashtags could not be saved: ${hashtagError.message}`);
    }

    let pollsSaved = true;
    for (const poll of newEventPolls) {
      const saved = await savePoll(createdEvent.id, poll);
      if (!saved) pollsSaved = false;
    }

    resetEventForm();
    setSelectedEventId(createdEvent.id);
    await loadEvents();
    await loadSuggestions();

    if (newEventPolls.length > 0) {
      setStatus(pollsSaved ? "Event and polls saved successfully." : "Event saved, but one or more polls failed.");
    } else {
      setStatus("Event saved successfully.");
    }
  };

  return (
    <div className="space-y-6 reveal">
      <section>
        <h1 className="page-title font-[var(--font-heading)]">Event Manager</h1>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <form className="card space-y-4" onSubmit={onSubmit}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-[var(--font-heading)] text-xl text-[#23332d]">
              {editingEventId ? "Edit Event" : "Add Event"}
            </h2>
            {editingEventId ? (
              <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={resetEventForm}>
                Cancel Edit
              </button>
            ) : null}
          </div>

          <div>
            <label className="field-label">Event Title</label>
            <input className="field-input" value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div>
            <label className="field-label">Details</label>
            <textarea
              className="field-input min-h-24"
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              placeholder="Description, schedule, notes"
            />
          </div>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="field-label" htmlFor="event-type">Event Type</label>
              <span className="rounded-full border border-[#9bb6ad] bg-[#edf5f2] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#2f5145]">
                Required
              </span>
            </div>
            <select
              id="event-type"
              className="field-input"
              value={eventType}
              onChange={(event) => setEventType(event.target.value as EventType | "")}
              required
            >
              <option value="">Select event type</option>
              {EVENT_TYPES.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          <section className="rounded-xl border border-[#cbd8d3] bg-[#f7faf8] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold text-[#2f4d43]">Hashtags</h3>
              </div>
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[#7a8b84]">
                {hashtags.filter((hashtag) => hashtag.is_default).length} system
              </span>
            </div>
            {hashtagAdminState === "denied" ? (
              <p className="mt-3 rounded-lg border border-[#d9e4df] bg-white px-3 py-2 text-xs text-[#5e766c]">
                Only social administrators can create hashtags. You can still select any existing hashtag below.
              </p>
            ) : (
              <>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    className="field-input"
                    value={newHashtagInput}
                    onChange={(event) => setNewHashtagInput(event.target.value)}
                    placeholder="#youth or #sunday_service"
                    aria-label="New hashtag"
                    disabled={hashtagAdminState === "checking"}
                  />
                  <button
                    type="button"
                    className="btn-ghost shrink-0"
                    onClick={() => void addHashtag()}
                    disabled={hashtagAdminState === "checking"}
                  >
                    {hashtagAdminState === "checking" ? "Checking access..." : "Create hashtag"}
                  </button>
                </div>
                <p className="mt-1 text-xs text-[#71847c]">
                  Use 1-50 letters, numbers, or underscores. Hashtags are case-insensitive, so #Youth and #youth are the same.
                </p>
              </>
            )}
            <HashtagPicker
              hashtags={hashtags}
              selectedIds={newEventHashtagIds}
              onChange={setNewEventHashtagIds}
              label="Available event hashtags"
            />
          </section>

          {!editingEventId ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-[var(--font-heading)] text-lg text-[#23332d]">Polls</h2>
                <button
                  type="button"
                  className="btn-ghost px-3 py-1 text-xs"
                  onClick={() => setNewEventPolls((previous) => [...previous, createPollDraft()])}
                >
                  + Add poll
                </button>
              </div>
              {newEventPolls.map((poll, pollIndex) => (
                <PollDraftEditor
                  key={poll.key}
                  draft={poll}
                  onChange={(nextDraft) =>
                    setNewEventPolls((previous) =>
                      previous.map((item, index) => index === pollIndex ? nextDraft : item)
                    )
                  }
                  onRemove={() =>
                    setNewEventPolls((previous) => previous.filter((item) => item.key !== poll.key))
                  }
                  scheduleReady={pollScheduleReady}
                  hashtags={hashtags}
                />
              ))}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="field-label">Location</label>
              <input className="field-input" value={location} onChange={(event) => setLocation(event.target.value)} />
            </div>
            <div>
              <label className="field-label">Event Date</label>
              <input className="field-input" type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} />
            </div>
          </div>
          <div>
            <label className="field-label">Poster Image</label>
            <input className="field-input" type="file" accept="image/*" onChange={onPosterChange} />
          </div>
          {posterUrl ? (
            <div className="relative h-48 w-full overflow-hidden rounded-xl border border-[#b9c8c2]">
              <Image
                src={posterUrl}
                alt="Poster Preview"
                fill
                className="object-cover"
                sizes="(max-width: 1024px) 100vw, 50vw"
                unoptimized
              />
            </div>
          ) : null}
          <button className="btn-primary" disabled={loading} type="submit">
            {loading
              ? editingEventId ? "Updating..." : "Saving..."
              : editingEventId ? "Update Event" : "Save Event"}
          </button>
          <div className="status-info">{status}</div>
        </form>

        <section id="recent-events" className="card scroll-mt-6">
          <h2 className="font-[var(--font-heading)] text-xl text-[#23332d]">Recent Events</h2>
          <div className="mt-4 space-y-3">
            {events.length === 0 ? (
              <p className="text-sm text-[#4f675e]">No events yet.</p>
            ) : (
              events.map((item) => (
                <article
                  key={item.id}
                  onClick={() => {
                    setSelectedEventId(item.id);
                    setEditingPoll(null);
                    setAdditionalPolls([]);
                    window.setTimeout(() => {
                      document.getElementById("event-details-polls")?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }, 0);
                  }}
                  className={`cursor-pointer rounded-xl border p-3 transition-all ${
                    selectedEventId === item.id
                      ? "border-[#7fa899] bg-[#ecf4f1] shadow-[0_8px_18px_rgba(56,91,79,0.1)]"
                      : "border-[#bfd0c9] bg-white/80"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-[#243730]">{item.title}</h3>
                      <p className="mt-1 text-xs text-[#5e766c]">
                        {item.event_date ?? "No date"} {item.location ? `• ${item.location}` : ""}
                      </p>
                      <span
                        className={
                          item.event_type
                            ? "mt-2 inline-block rounded-full border border-[#9fc6b7] bg-[#e7f4ee] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#245142]"
                            : "mt-2 inline-block rounded-full border border-[#e3c98f] bg-[#fdf6e6] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#7a5a17]"
                        }
                      >
                        {item.event_type ?? "Needs review"}
                      </span>
                      {item.details ? <p className="mt-2 text-sm text-[#3e5850] line-clamp-2">{item.details}</p> : null}
                    </div>
                    <div className="flex shrink-0 flex-col gap-2">
                      <button
                        type="button"
                        className="btn-ghost px-3 py-1 text-xs"
                        onClick={(event) => {
                          event.stopPropagation();
                          void startEditingEvent(item);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-ghost px-3 py-1 text-xs text-[#8a3f46]"
                        disabled={
                          deletingEventId === item.id ||
                          (deleteChecking && deleteTarget?.id === item.id)
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          void beginDeleteEvent(item.id);
                        }}
                      >
                        {deletingEventId === item.id
                          ? "Deleting..."
                          : deleteChecking && deleteTarget?.id === item.id
                            ? "Checking..."
                            : "Delete"}
                      </button>
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>

      <section className="analytics-panel">
        <div className="section-head">
          <div>
            <h2 className="font-[var(--font-heading)] text-xl text-[#23332d]">Calendar Image</h2>
            <p className="mt-1 text-xs text-[#5e766c]">
            </p>
          </div>
          {calendarRow?.calendar_img_url ? (
            <span className="rounded-full border border-[#9fc6b7] bg-[#e7f4ee] px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#245142]">
              Published
            </span>
          ) : null}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <CalendarImage
            src={calendarPreviewUrl ?? calendarRow?.calendar_img_url ?? null}
            alt="Monthly calendar"
            emptyMessage="No calendar image has been uploaded yet."
            className="aspect-[4/3] w-full"
          />

          <div className="space-y-3">
            <input
              className="field-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={onCalendarFileChange}
              disabled={!calendarSchemaReady || calendarUploading}
            />
            <p className="text-xs text-[#5e766c]">JPEG, PNG, or WebP. Maximum 5 MB.</p>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary"
                onClick={() => void uploadCalendarImage()}
                disabled={!calendarFile || !calendarSchemaReady || calendarUploading}
              >
                {calendarUploading ? "Uploading..." : calendarRow?.calendar_img_url ? "Replace calendar image" : "Upload calendar image"}
              </button>
              {calendarFile ? (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setCalendarFile(null);
                    setCalendarPreviewUrl(null);
                  }}
                  disabled={calendarUploading}
                >
                  Cancel
                </button>
              ) : null}
              {calendarRow?.calendar_img_url ? (
                <button
                  type="button"
                  className="btn-ghost text-[#8a3f46]"
                  onClick={() => void removeCalendarImage()}
                  disabled={calendarUploading}
                >
                  Remove
                </button>
              ) : null}
            </div>

            {calendarStatus ? (
              <p className={calendarStatusIsError ? "status-error" : "status-success"}>{calendarStatus}</p>
            ) : null}
          </div>
        </div>
      </section>

      <section id="event-details-polls" className="analytics-panel scroll-mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-[var(--font-heading)] text-xl text-[#23332d]">Event Details and Polls</h2>
          {selectedEvent ? (
            <span className="rounded-full border border-[#afc4bc] bg-white/85 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#406357]">
              Active Event
            </span>
          ) : null}
        </div>

        {!selectedEvent ? (
          <p className="mt-3 text-sm text-[#4f675e]">Click an event in Recent Events to view details, polls, and suggestions.</p>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="rounded-2xl border border-[#bdd0c9] bg-white p-4 shadow-[0_8px_18px_rgba(56,91,79,0.06)]">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-[var(--font-heading)] text-xl text-[#243730]">{selectedEvent.title}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={
                      selectedEvent.event_type
                        ? "rounded-full border border-[#9fc6b7] bg-[#e7f4ee] px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#245142]"
                        : "rounded-full border border-[#e3c98f] bg-[#fdf6e6] px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#7a5a17]"
                    }
                  >
                    {selectedEvent.event_type ?? "Needs review"}
                  </span>
                  <button
                    type="button"
                    className="btn-ghost px-3 py-1 text-xs"
                    onClick={() => startEditingEvent(selectedEvent)}
                  >
                    Edit
                  </button>
                </div>
              </div>
              <p className="mt-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#5e766c]">
                {selectedEvent.event_date ?? "No date"}
                {selectedEvent.location ? ` • ${selectedEvent.location}` : ""}
              </p>
              {selectedEvent.details ? <p className="mt-2 text-sm text-[#3e5850]">{selectedEvent.details}</p> : null}
            </div>

            <div className="rounded-2xl border border-[#bdd0c9] bg-white/85 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-[#4f675e]">Event Attendance</h3>
              <p className="mt-1 font-[var(--font-heading)] text-2xl text-[#23332d]">{selectedEventAttendance.length}</p>
              {attendanceStatus ? <p className="mt-2 text-xs font-semibold text-[#7a3237]">{attendanceStatus}</p> : null}
              <div className="mt-3 space-y-2">
                {selectedEventAttendance.length === 0 ? (
                  <p className="text-sm text-[#5e766c]">No scans linked to this event yet.</p>
                ) : (
                  selectedEventAttendance.slice(0, 6).map((row) => (
                    <div key={row.id} className="flex items-center justify-between rounded-xl border border-[#cbd8d3] bg-white px-3 py-2 text-sm text-[#2f4d43]">
                      <div>
                        <p className="font-semibold">{row.full_name}</p>
                        <p className="text-xs text-[#5e766c]">{row.student_id} • {row.attendance_group ?? "-"}</p>
                      </div>
                      <p className="text-xs font-semibold text-[#4f675e]">
                        {new Date(row.attended_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <section className="space-y-3 rounded-2xl border border-[#bdd0c9] bg-white/85 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-[var(--font-heading)] text-lg text-[#23332d]">Polls</h3>
                </div>
                <button
                  type="button"
                  className="btn-ghost px-3 py-1 text-xs"
                  onClick={() => setAdditionalPolls((previous) => [...previous, createPollDraft()])}
                  disabled={!pollSchemaReady}
                >
                  + Add poll
                </button>
              </div>

              {!pollSchemaReady ? (
                <p className="status-error">
                  Poll editing is not enabled yet. Run supabase/patch_2026_10_22_polls_calendar.sql and supabase/patch_2026_10_24_poll_main_question.sql in the Supabase SQL Editor.
                </p>
              ) : null}
              {pollSchemaReady && !pollScheduleReady ? (
                <p className="status-info">
                  Poll scheduling is not enabled yet. Run supabase/patch_2026_11_02_poll_name_schedule.sql to add start
                  and end times. Poll labels use the event type.
                </p>
              ) : null}
              {submissionStatus ? <p className="status-info">{submissionStatus}</p> : null}

              {activePolls.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[#bdcec8] bg-white/70 px-3 py-2 text-sm text-[#5e766c]">
                  No active polls for this event yet.
                </p>
              ) : (
                activePolls.map((poll) => (
                  <PollResultCard
                    key={poll.key}
                    poll={poll}
                    now={now}
                    counts={voteSummary.counts}
                    total={pollVoteTotal(poll)}
                    memberCount={memberDenominator.count}
                    memberLabel={memberDenominator.label}
                    hashtags={hashtags}
                    onEdit={() => startEditingPoll(poll)}
                    onStatusChange={(nextStatus) => void changePollStatus(poll, nextStatus)}
                    onDelete={() => requestDeletePoll(poll)}
                  />
                ))
              )}

              {archivedPolls.length > 0 ? (
                <div className="rounded-xl border border-[#d6e1dd] bg-[#f7f9f8] p-3">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 text-left text-xs font-semibold text-[#5f6f68]"
                    onClick={() => setShowArchivedPolls((previous) => !previous)}
                  >
                    <span>Archived polls ({archivedPolls.length})</span>
                    <span>{showArchivedPolls ? "Hide" : "Show"}</span>
                  </button>
                  {showArchivedPolls ? (
                    <div className="mt-3 space-y-3">
                      {archivedPolls.map((poll) => (
                        <PollResultCard
                          key={poll.key}
                          poll={poll}
                          now={now}
                          counts={voteSummary.counts}
                          total={pollVoteTotal(poll)}
                          memberCount={memberDenominator.count}
                          memberLabel={memberDenominator.label}
                          hashtags={hashtags}
                          onEdit={() => startEditingPoll(poll)}
                          onStatusChange={(nextStatus) => void changePollStatus(poll, nextStatus)}
                          onDelete={() => requestDeletePoll(poll)}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {editingPoll ? (
                <form
                  className="space-y-3"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (await savePoll(selectedEvent.id, editingPoll)) {
                      setEditingPoll(null);
                    }
                  }}
                >
                  <h4 className="text-sm font-semibold uppercase tracking-[0.08em] text-[#4f675e]">Edit poll</h4>
                  <PollDraftEditor
                    draft={editingPoll}
                    onChange={setEditingPoll}
                    onRemove={() => setEditingPoll(null)}
                    scheduleReady={pollScheduleReady}
                    hashtags={hashtags}
                    removeLabel="Cancel"
                  />
                  <button type="submit" className="btn-primary">Save changes</button>
                </form>
              ) : null}

              {additionalPolls.length > 0 ? (
                <form
                  className="space-y-3"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const savedKeys: string[] = [];
                    for (const poll of additionalPolls) {
                      const saved = await savePoll(selectedEvent.id, poll);
                      if (saved) savedKeys.push(poll.key);
                    }
                    if (savedKeys.length > 0) {
                      setAdditionalPolls((previous) => previous.filter((poll) => !savedKeys.includes(poll.key)));
                    }
                  }}
                >
                  <h4 className="text-sm font-semibold uppercase tracking-[0.08em] text-[#4f675e]">New polls</h4>
                  {additionalPolls.map((poll, pollIndex) => (
                    <PollDraftEditor
                      key={poll.key}
                      draft={poll}
                      onChange={(nextDraft) =>
                        setAdditionalPolls((previous) =>
                          previous.map((item, index) => index === pollIndex ? nextDraft : item)
                        )
                      }
                      onRemove={() =>
                        setAdditionalPolls((previous) => previous.filter((item) => item.key !== poll.key))
                      }
                      scheduleReady={pollScheduleReady}
                      hashtags={hashtags}
                    />
                  ))}
                  <button type="submit" className="btn-primary">Save polls</button>
                </form>
              ) : null}
            </section>

            <div>
              <p className="text-sm font-semibold text-[#35564a]">Quick Suggestions</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {DEFAULT_FOOD_SUGGESTIONS.map((food) => (
                  <button
                    key={food}
                    type="button"
                    className="rounded-full border border-[#8aa79b] bg-white px-4 py-2 text-sm font-semibold text-[#2f5145] transition hover:bg-[#edf5f2]"
                    onClick={() => void addSuggestion(selectedEvent.id, food)}
                  >
                    {food}
                  </button>
                ))}
              </div>
            </div>

            <form
              className="flex flex-col gap-2 md:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                void addSuggestion(selectedEvent.id, suggestionInput);
              }}
            >
              <input
                className="field-input md:flex-1"
                value={suggestionInput}
                onChange={(event) => setSuggestionInput(event.target.value)}
                placeholder="Type a plain suggestion for this event..."
              />
              <button type="submit" className="btn-primary md:min-w-[120px]">
                Add Suggestion
              </button>
            </form>

            {suggestionStatus ? <p className="text-xs font-semibold text-[#49675c]">{suggestionStatus}</p> : null}

            <div className="space-y-2">
              {selectedEventPlainSuggestions.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[#bdcec8] bg-white/70 px-3 py-2 text-sm text-[#5e766c]">
                  No plain suggestions yet for this event.
                </p>
              ) : (
                selectedEventPlainSuggestions.map((item) => (
                  <div key={item.id} className="flex items-center justify-between rounded-xl border border-[#cbd8d3] bg-white px-3 py-2 text-sm text-[#2f4d43] shadow-[0_4px_10px_rgba(56,91,79,0.05)]">
                    <span>{item.suggestion_text}</span>
                    <button
                      type="button"
                      className="rounded-full border border-[#d9b6ba] px-3 py-1 text-xs font-semibold text-[#8a3f46] transition hover:bg-[#fff3f4]"
                      onClick={() => void removeSuggestion(item.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </section>

      {notification ? (
        <AppNotification
          tone={notification.tone}
          message={notification.message}
          onDismiss={() => setNotification(null)}
        />
      ) : null}
      {pollDeleteTarget ? (
        <AppNotification
          tone="warning"
          variant="dialog"
          title="Delete poll?"
          message={`Delete "${pollDeleteTarget.name || pollDeleteTarget.question}" and all of its votes? This cannot be undone.`}
          confirmLabel="Delete Poll"
          onCancel={() => setPollDeleteTarget(null)}
          onConfirm={() => void deletePoll(pollDeleteTarget)}
          busy={deletingPollKey === pollDeleteTarget.key}
        />
      ) : null}
      {deleteTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1b2a25]/45 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-event-title"
        >
          <div className="w-full max-w-lg rounded-2xl border border-[#d8c3c5] bg-[#eaeaea] p-5 shadow-2xl">
            <h2 id="delete-event-title" className="font-[var(--font-heading)] text-xl text-[#3a282a]">
              {deleteStep === "confirm-attendance" ? "Permanently delete attendance?" : "Delete event?"}
            </h2>

            {deleteChecking ? (
              <p className="mt-3 text-sm text-[#5b4547]">Checking linked attendance...</p>
            ) : deleteError && deleteAttendanceCount === null ? (
              <p className="mt-3 text-sm text-[#5b4547]">
                Could not check linked attendance. Close this dialog and try again.
              </p>
            ) : deleteStep === "confirm-attendance" ? (
              <p className="mt-3 text-sm text-[#5b4547]">
                This permanently deletes{" "}
                <span className="font-semibold">{deleteAttendanceCount ?? 0} attendance record(s)</span> for{" "}
                <span className="font-semibold">{deleteTarget.title}</span>, along with the event, its polls, votes,
                and suggestions. This cannot be undone.
              </p>
            ) : (deleteAttendanceCount ?? 0) > 0 ? (
              <p className="mt-3 text-sm text-[#5b4547]">
                <span className="font-semibold">{deleteTarget.title}</span> has{" "}
                <span className="font-semibold">{deleteAttendanceCount} attendance record(s)</span> linked to it. What
                should happen to them?
              </p>
            ) : (
              <p className="mt-3 text-sm text-[#5b4547]">
                Are you sure you want to delete <span className="font-semibold">{deleteTarget.title}</span>
                {deleteTarget.event_date ? ` on ${formatEventDate(deleteTarget.event_date)}` : ""}? This cannot be
                undone.
              </p>
            )}

            {deleteError ? (
              <p className="mt-3 rounded-xl border border-[#e2b9bb] bg-[#f8eded] px-3 py-2 text-sm text-[#7a3237]">
                {deleteError}
              </p>
            ) : null}

            <div className="mt-5 flex flex-col gap-2">
              {deleteChecking ? (
                <button type="button" className="btn-ghost w-full" onClick={closeDeleteModal}>
                  Cancel
                </button>
              ) : deleteStep === "confirm-attendance" ? (
                <>
                  <button
                    type="button"
                    className="inline-flex w-full items-center justify-center rounded-full bg-[#8a3f46] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#73343a] disabled:opacity-50"
                    onClick={() => void runDeleteEvent("delete")}
                    disabled={Boolean(deletingEventId)}
                  >
                    {deletingEventId ? "Deleting..." : "Yes, delete records and event"}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost w-full"
                    onClick={() => setDeleteStep("choice")}
                    disabled={Boolean(deletingEventId)}
                  >
                    Cancel
                  </button>
                </>
              ) : deleteAttendanceCount === null ? (
                <button type="button" className="btn-ghost w-full" onClick={closeDeleteModal}>
                  Close
                </button>
              ) : (deleteAttendanceCount ?? 0) > 0 ? (
                <>
                  <button
                    type="button"
                    className="btn-primary w-full"
                    onClick={() => void runDeleteEvent("keep")}
                    disabled={Boolean(deletingEventId)}
                  >
                    {deletingEventId ? "Deleting..." : "Keep attendance & delete event"}
                  </button>
                  <button
                    type="button"
                    className="inline-flex w-full items-center justify-center rounded-full border border-[#c9a6aa] px-4 py-2.5 text-sm font-semibold text-[#8a3f46] transition hover:bg-[#fff3f4] disabled:opacity-50"
                    onClick={() => setDeleteStep("confirm-attendance")}
                    disabled={Boolean(deletingEventId)}
                  >
                    Delete attendance &amp; event
                  </button>
                  <button
                    type="button"
                    className="btn-ghost w-full"
                    onClick={closeDeleteModal}
                    disabled={Boolean(deletingEventId)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="inline-flex w-full items-center justify-center rounded-full bg-[#8a3f46] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#73343a] disabled:opacity-50"
                    onClick={() => void runDeleteEvent("keep")}
                    disabled={Boolean(deletingEventId) || deleteAttendanceCount === null}
                  >
                    {deletingEventId ? "Deleting..." : "Delete event"}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost w-full"
                    onClick={closeDeleteModal}
                    disabled={Boolean(deletingEventId)}
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
