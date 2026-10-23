"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import CalendarImage from "@/components/calendar-image";
import { hasSupabaseEnv, supabase, supabaseEnvIssue } from "@/lib/supabase";
import {
  createPollChoice,
  createPollDraft,
  isPollStatus,
  isUuid,
  parsePollSuggestion,
  pollStatusLabel,
  validatePollDraft
} from "@/lib/polls";
import {
  CalendarImageRow,
  EventItem,
  EventPollSubmission,
  EventSuggestion,
  PollStatus
} from "@/types";

type EventAttendanceRow = {
  id: string;
  full_name: string;
  student_id: string;
  attended_at: string;
  attendance_group: string | null;
};

type SavedPollChoice = {
  rowId: string;
  text: string;
  archivedAt: string | null;
  sortOrder: number;
};

type SavedPoll = {
  key: string;
  question: string;
  createdAt: string;
  status: PollStatus;
  choices: SavedPollChoice[];
  legacyQuestionRowId: string | null;
};

type PollDraftEditorProps = {
  draft: ReturnType<typeof createPollDraft>;
  onChange: (draft: ReturnType<typeof createPollDraft>) => void;
  onRemove: () => void;
  removeLabel?: string;
};

const SUGGESTION_COLUMNS =
  "id,event_id,suggestion_text,suggestion_question_text,created_at,poll_key,item_kind,poll_status,archived_at,sort_order,updated_at";
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

function buildPolls(rows: EventSuggestion[]): SavedPoll[] {
  const polls = new Map<string, SavedPoll>();

  for (const row of rows) {
    if (!isPollSuggestionRow(row)) continue;

    const parsed = parsePollSuggestion(row.suggestion_text);
    const key = rowPollKey(row);
    const poll = polls.get(key) ?? {
      key,
      question: "",
      createdAt: row.created_at,
      status: "open" as PollStatus,
      choices: [],
      legacyQuestionRowId: null
    };

    if (row.created_at && (!poll.createdAt || row.created_at < poll.createdAt)) {
      poll.createdAt = row.created_at;
    }

    const questionText = row.suggestion_question_text?.trim() ?? "";
    const rowStatus = isPollStatus(row.poll_status) ? row.poll_status : null;

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

function statusBadgeClass(status: PollStatus) {
  if (status === "closed") return "border-[#d8c58e] bg-[#fff8df] text-[#6f5a18]";
  if (status === "archived") return "border-[#c6c9c7] bg-[#f1f3f2] text-[#58635f]";
  return "border-[#9fc6b7] bg-[#e7f4ee] text-[#245142]";
}

function PollDraftEditor({
  draft,
  onChange,
  onRemove,
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
          <label className="field-label" htmlFor={`poll-question-${draft.key}`}>
            Poll question
          </label>
          <input
            id={`poll-question-${draft.key}`}
            className="field-input rounded-none border-0 border-b-2 border-[#dadce0] bg-[#f8f9fa] focus:border-[#4285f4] focus:ring-0"
            value={draft.question}
            onChange={(event) => onChange({ ...draft, question: event.target.value })}
            placeholder="Ask the app users a question"
          />
        </div>
        <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={onRemove}>
          {removeLabel}
        </button>
      </div>

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
  counts,
  total,
  onEdit,
  onStatusChange,
  onDelete
}: {
  poll: SavedPoll;
  counts: Map<string, number>;
  total: number;
  onEdit: () => void;
  onStatusChange: (status: PollStatus) => void;
  onDelete: () => void;
}) {
  const activeChoices = poll.choices.filter((choice) => !choice.archivedAt);
  const archivedChoices = poll.choices.filter((choice) => choice.archivedAt);

  return (
    <article className="rounded-xl border border-[#cbd8d3] bg-white p-4 text-sm text-[#2f4d43]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${statusBadgeClass(poll.status)}`}>
              {pollStatusLabel(poll.status)}
            </span>
            <span className="text-xs font-semibold text-[#5f6f68]">
              {total} {total === 1 ? "vote" : "votes"}
            </span>
          </div>
          <p className="mt-2 font-semibold">{poll.question}</p>
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

      <div className="mt-3 space-y-2">
        {activeChoices.length === 0 ? (
          <p className="text-sm text-[#5e766c]">No active options. Edit this poll to add options.</p>
        ) : (
          activeChoices.map((choice) => {
            const count = counts.get(choice.rowId) ?? 0;
            const percent = total > 0 ? Math.round((count / total) * 100) : 0;

            return (
              <div key={choice.rowId} className="rounded-xl border border-[#d6e1dd] bg-[#fbfdfc] px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex-1">{choice.text}</span>
                  <span className="text-xs font-semibold text-[#4f675e]">{count} ({percent}%)</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e3ece8]">
                  <div className="h-full rounded-full bg-[#4285f4]" style={{ width: `${percent}%` }} />
                </div>
              </div>
            );
          })
        )}
      </div>

      {archivedChoices.length > 0 ? (
        <details className="mt-3 rounded-xl border border-[#d6e1dd] bg-[#f7f9f8] px-3 py-2">
          <summary className="cursor-pointer text-xs font-semibold text-[#5f6f68]">
            Archived options ({archivedChoices.length})
          </summary>
          <div className="mt-2 space-y-1">
            {archivedChoices.map((choice) => (
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
  const [newEventPolls, setNewEventPolls] = useState<ReturnType<typeof createPollDraft>[]>([]);
  const [additionalPolls, setAdditionalPolls] = useState<ReturnType<typeof createPollDraft>[]>([]);
  const [editingPoll, setEditingPoll] = useState<ReturnType<typeof createPollDraft> | null>(null);
  const [showArchivedPolls, setShowArchivedPolls] = useState(false);
  const [location, setLocation] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventSuggestions, setEventSuggestions] = useState<EventSuggestion[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [suggestionInput, setSuggestionInput] = useState("");
  const [suggestionStatus, setSuggestionStatus] = useState("");
  const [submissionStatus, setSubmissionStatus] = useState("");
  const [selectedEventAttendance, setSelectedEventAttendance] = useState<EventAttendanceRow[]>([]);
  const [attendanceStatus, setAttendanceStatus] = useState("");
  const [submissions, setSubmissions] = useState<EventPollSubmission[]>([]);
  const [pollSchemaReady, setPollSchemaReady] = useState(true);
  const [submissionSchemaReady, setSubmissionSchemaReady] = useState(true);
  const [status, setStatus] = useState("Manage events and publish them to the home page.");
  const [loading, setLoading] = useState(false);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [calendarRow, setCalendarRow] = useState<CalendarImageRow | null>(null);
  const [calendarSchemaReady, setCalendarSchemaReady] = useState(true);
  const [calendarFile, setCalendarFile] = useState<File | null>(null);
  const [calendarPreviewUrl, setCalendarPreviewUrl] = useState<string | null>(null);
  const [calendarStatus, setCalendarStatus] = useState("");
  const [calendarStatusIsError, setCalendarStatusIsError] = useState(false);
  const [calendarUploading, setCalendarUploading] = useState(false);

  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? null;

  const selectedEventSuggestions = useMemo(
    () => (selectedEventId ? eventSuggestions.filter((row) => row.event_id === selectedEventId) : []),
    [eventSuggestions, selectedEventId]
  );

  const selectedEventPolls = useMemo(
    () => buildPolls(selectedEventSuggestions),
    [selectedEventSuggestions]
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
      .select("id, title, details, event_date, location, poster_url, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      if (isMissingEventsTableError(error.message)) {
        setEvents([]);
        setStatus("Events table is missing. Run supabase/schema.sql in Supabase SQL Editor, then refresh this page.");
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

  const loadSuggestions = useCallback(async () => {
    if (!hasSupabaseEnv) return;

    const { data, error } = await supabase
      .from("event_suggestions")
      .select(SUGGESTION_COLUMNS)
      .order("created_at", { ascending: true });

    if (error) {
      if (isMissingColumnError(error.message)) {
        setPollSchemaReady(false);
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
          "Poll editing is not enabled yet. Run supabase/patch_2026_10_22_polls_calendar.sql in Supabase SQL Editor."
        );
        return;
      }

      if (isMissingEventSuggestionsTableError(error.message)) {
        setSuggestionStatus("Event suggestions table is missing. Run supabase/schema.sql to enable suggestions.");
        return;
      }

      setSuggestionStatus(`Failed to load suggestions: ${error.message}`);
      return;
    }

    setPollSchemaReady(true);
    setEventSuggestions((data ?? []) as EventSuggestion[]);
  }, []);

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
      void loadSuggestions();
      void loadCalendar();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadCalendar, loadEvents, loadSuggestions]);

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
        "Poll editing is not enabled yet. Run supabase/patch_2026_10_22_polls_calendar.sql first."
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

    const fail = async (message: string) => {
      setSuggestionStatus(message);
      await loadSuggestions();
      return false;
    };

    if (!pollAlreadyExists) {
      const rows = choices.map((choice, index) => ({
        event_id: eventId,
        suggestion_text: choice.text,
        suggestion_question_text: question,
        poll_key: pollKey,
        item_kind: "choice",
        poll_status: draft.status,
        archived_at: null,
        sort_order: index,
        updated_at: now
      }));

      const { data, error } = await supabase
        .from("event_suggestions")
        .insert(rows)
        .select(SUGGESTION_COLUMNS);

      if (error) {
        return fail(`Failed to save poll: ${error.message}`);
      }

      setEventSuggestions((previous) => [...previous, ...((data ?? []) as EventSuggestion[])]);
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
        suggestion_question_text: question,
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
        .update({ archived_at: now, updated_at: now })
        .in("id", rowIdsToArchive);

      if (archiveResult.error) {
        return fail(`Failed to archive removed options: ${archiveResult.error.message}`);
      }
    }

    let keptLegacyQuestion = false;
    for (const questionRow of legacyQuestionRows) {
      const hasVotes = submissions.some((submission) => submission.question_id === questionRow.id);
      if (hasVotes) {
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
        "Poll status is not enabled yet. Run supabase/patch_2026_10_22_polls_calendar.sql first."
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
        ? "Poll reopened."
        : nextStatus === "closed"
          ? "Poll closed."
          : "Poll archived."
    );
  };

  const deletePoll = async (poll: SavedPoll) => {
    if (!window.confirm(`Delete "${poll.question}" and all of its votes? This cannot be undone.`)) {
      return;
    }

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

    const { error } = await supabase
      .from("event_suggestions")
      .delete()
      .in("id", rowIds);

    if (error) {
      setSuggestionStatus(`Failed to delete poll: ${error.message}`);
      return;
    }

    if (editingPoll?.key === poll.key) {
      setEditingPoll(null);
    }

    await Promise.all([
      loadSuggestions(),
      selectedEventId ? loadSubmissions(selectedEventId) : Promise.resolve()
    ]);
    setSuggestionStatus("Poll deleted.");
  };

  const startEditingPoll = (poll: SavedPoll) => {
    setEditingPoll({
      key: poll.key,
      question: poll.question,
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

  const deleteEvent = async (eventId: string) => {
    const eventToDelete = events.find((item) => item.id === eventId);
    if (!eventToDelete || !window.confirm(`Delete "${eventToDelete.title}"?`)) return;

    setDeletingEventId(eventId);
    const { error: unlinkError } = await supabase.from("attendance").update({ event_id: null }).eq("event_id", eventId);
    if (unlinkError && !isMissingAttendanceEventIdError(unlinkError.message)) {
      setStatus(`Failed to prepare event deletion: ${unlinkError.message}`);
      setDeletingEventId(null);
      return;
    }

    await supabase.from("EventPoll_Submissions").delete().eq("event_id", eventId);

    const { error } = await supabase.from("events").delete().eq("id", eventId);
    setDeletingEventId(null);
    if (error) {
      setStatus(`Failed to delete event: ${error.message}`);
      return;
    }

    const remainingEvents = events.filter((item) => item.id !== eventId);
    setEvents(remainingEvents);
    setSelectedEventId((current) => current === eventId ? remainingEvents[0]?.id ?? null : current);
    setEventSuggestions((previous) => previous.filter((item) => item.event_id !== eventId));
    setStatus("Event deleted. Attendance records were kept; poll votes for the event were removed.");
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

    for (const poll of newEventPolls) {
      const validationError = validatePollDraft(poll);
      if (validationError) {
        setStatus(validationError);
        return;
      }
    }

    setLoading(true);
    const { data: createdEvent, error } = await supabase.from("events").insert({
      title: title.trim(),
      details: details.trim() || null,
      location: location.trim() || null,
      event_date: eventDate || null,
      poster_url: posterUrl
    }).select("id").single();
    setLoading(false);

    if (error) {
      if (isMissingEventsTableError(error.message)) {
        setStatus("Cannot save event yet. Run supabase/schema.sql in Supabase SQL Editor first.");
        return;
      }

      setStatus(`Failed to save event: ${error.message}`);
      return;
    }

    let pollsSaved = true;
    for (const poll of newEventPolls) {
      const saved = await savePoll(createdEvent.id, poll);
      if (!saved) pollsSaved = false;
    }

    setTitle("");
    setDetails("");
    setNewEventPolls([]);
    setLocation("");
    setEventDate("");
    setPosterUrl(null);
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
        <p className="page-subtitle">Add posters, polls, and calendar images. Published events appear on the home dashboard.</p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <form className="card space-y-4" onSubmit={onSubmit}>
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
            <p className="text-xs text-[#5e766c]">
              The question is separate from the options. App users vote on open polls.
            </p>
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
              />
            ))}
          </div>

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
            {loading ? "Saving..." : "Save Event"}
          </button>
          <div className="status-info">{status}</div>
        </form>

        <section className="card">
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
                      {item.details ? <p className="mt-1 text-sm text-[#3e5850] line-clamp-2">{item.details}</p> : null}
                    </div>
                    <button
                      type="button"
                      className="btn-ghost shrink-0 px-3 py-1 text-xs text-[#8a3f46]"
                      disabled={deletingEventId === item.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        void deleteEvent(item.id);
                      }}
                    >
                      {deletingEventId === item.id ? "Deleting..." : "Delete"}
                    </button>
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
              This image is published to the Events page and can be read by the app.
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

      <section className="analytics-panel">
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
              <p className="font-[var(--font-heading)] text-xl text-[#243730]">{selectedEvent.title}</p>
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
                  <p className="mt-1 text-xs text-[#5e766c]">
                    Results are read-only here. App users vote and can change their vote while a poll is open.
                  </p>
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
                  Poll editing is not enabled yet. Run supabase/patch_2026_10_22_polls_calendar.sql in the Supabase SQL Editor.
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
                    counts={voteSummary.counts}
                    total={pollVoteTotal(poll)}
                    onEdit={() => startEditingPoll(poll)}
                    onStatusChange={(nextStatus) => void changePollStatus(poll, nextStatus)}
                    onDelete={() => void deletePoll(poll)}
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
                          counts={voteSummary.counts}
                          total={pollVoteTotal(poll)}
                          onEdit={() => startEditingPoll(poll)}
                          onStatusChange={(nextStatus) => void changePollStatus(poll, nextStatus)}
                          onDelete={() => void deletePoll(poll)}
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
    </div>
  );
}
