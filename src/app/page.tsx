"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { hasSupabaseEnv, supabase, supabaseEnvIssue } from "@/lib/supabase";
import { AttendanceLog, EventItem, EventSuggestion, UserFace } from "@/types";
import SimpleBarChart from "@/components/simple-bar-chart";
import StackedPercentageChart from "@/components/stacked-percentage-chart";
import AnalyticsFunnel from "@/components/analytics-funnel";
import { GROUP_COLORS } from "@/lib/analytics-colors";
import { NETWORK_LABELS, buildStudentNetworkMap, createEmptyNetworkCounts } from "@/lib/networks";

type AnalyticsView = "mix" | "funnel";
const MIN_ANALYTICS_DATE = "2026-01-01";
const POLL_QUESTION_PREFIX = "[POLL_Q] ";
const POLL_CHOICE_PREFIX = "[POLL_C] ";

function isMissingColumnError(message: string) {
  return /column\s+users\.(age|gender|newcomer)\s+does not exist/i.test(message);
}

function isMissingAttendanceColumnError(message: string) {
  return /column\s+attendance\.was_newcomer\s+does not exist/i.test(message);
}

function isMissingClassificationColumnError(message: string) {
  return /column\s+attendance\.(attendance_context|attendance_group)\s+does not exist/i.test(message);
}

function isMissingEventsTableError(message: string) {
  return /Could not find the table 'public\.events'|relation\s+"?events"?\s+does not exist/i.test(message);
}

function isMissingEventSuggestionsTableError(message: string) {
  return /Could not find the table 'public\.event_suggestions'|relation\s+"?event_suggestions"?\s+does not exist/i.test(message);
}

export default function HomePage() {
  const [users, setUsers] = useState<UserFace[]>([]);
  const [attendance, setAttendance] = useState<AttendanceLog[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventSuggestions, setEventSuggestions] = useState<EventSuggestion[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [suggestionInput, setSuggestionInput] = useState("");
  const [pollQuestionInput, setPollQuestionInput] = useState("");
  const [pollChoicesInput, setPollChoicesInput] = useState("");
  const [status, setStatus] = useState("Loading dashboard analytics...");
  const [analyticsView, setAnalyticsView] = useState<AnalyticsView>("mix");
  const [suggestionStatus, setSuggestionStatus] = useState("");

  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? null;

  const selectedEventSuggestions = useMemo(
    () => (selectedEventId ? eventSuggestions.filter((row) => row.event_id === selectedEventId) : []),
    [eventSuggestions, selectedEventId]
  );

  const selectedEventPollQuestion = useMemo(
    () => selectedEventSuggestions.find((item) => item.suggestion_text.startsWith(POLL_QUESTION_PREFIX)) ?? null,
    [selectedEventSuggestions]
  );

  const selectedEventPollChoices = useMemo(
    () => selectedEventSuggestions.filter((item) => item.suggestion_text.startsWith(POLL_CHOICE_PREFIX)),
    [selectedEventSuggestions]
  );

  const selectedEventOtherSuggestions = useMemo(
    () =>
      selectedEventSuggestions.filter(
        (item) => !item.suggestion_text.startsWith(POLL_QUESTION_PREFIX) && !item.suggestion_text.startsWith(POLL_CHOICE_PREFIX)
      ),
    [selectedEventSuggestions]
  );

  const range = useMemo(() => {
    const today = new Date();
    const format = (date: Date) => date.toISOString().slice(0, 10);

    const day = format(today);
    return { from: day < MIN_ANALYTICS_DATE ? MIN_ANALYTICS_DATE : day, to: day };
  }, []);

  useEffect(() => {
    const loadData = async () => {
      if (!hasSupabaseEnv) {
        setStatus(supabaseEnvIssue ?? "Missing Supabase environment values.");
        return;
      }

      const warnings: string[] = [];

      let userRows: UserFace[] = [];
      const userResult = await supabase.from("users").select("id, student_id, full_name, age, gender, newcomer, descriptor, created_at");
      if (userResult.error) {
        if (isMissingColumnError(userResult.error.message)) {
          const fallback = await supabase.from("users").select("id, student_id, full_name, descriptor, created_at");
          if (fallback.error) {
            setStatus(`Failed to load dashboard: ${fallback.error.message}`);
            return;
          }

          userRows = ((fallback.data ?? []) as Array<Omit<UserFace, "age" | "gender" | "newcomer">>).map((row) => ({
            ...row,
            age: null,
            gender: null,
            newcomer: false
          }));
          warnings.push("Users schema is outdated. Run supabase/schema.sql to add age, gender, and newcomer.");
        } else {
          setStatus(`Failed to load dashboard: ${userResult.error.message}`);
          return;
        }
      } else {
        userRows = (userResult.data ?? []) as UserFace[];
      }

      let attendanceRows: AttendanceLog[] = [];
      const attendanceResult = await supabase
        .from("attendance")
        .select("id, student_id, full_name, was_newcomer, attendance_context, attendance_group, attended_date, attended_at")
        .gte("attended_date", range.from)
        .lte("attended_date", range.to);

      if (attendanceResult.error) {
        if (
          isMissingAttendanceColumnError(attendanceResult.error.message) ||
          isMissingClassificationColumnError(attendanceResult.error.message)
        ) {
          const fallback = await supabase
            .from("attendance")
            .select("id, student_id, full_name, attended_date, attended_at")
            .gte("attended_date", range.from)
            .lte("attended_date", range.to);

          if (fallback.error) {
            setStatus(`Failed to load dashboard: ${fallback.error.message}`);
            return;
          }

          attendanceRows = ((fallback.data ?? []) as Array<Omit<AttendanceLog, "was_newcomer" | "attendance_context" | "attendance_group">>).map((row) => ({
            ...row,
            was_newcomer: false,
            attendance_context: null,
            attendance_group: null
          }));
          warnings.push("Attendance schema is outdated. Run supabase/schema.sql to add was_newcomer, attendance_context, and attendance_group.");
        } else {
          setStatus(`Failed to load dashboard: ${attendanceResult.error.message}`);
          return;
        }
      } else {
        attendanceRows = (attendanceResult.data ?? []) as AttendanceLog[];
      }

      let eventRows: EventItem[] = [];
      const eventsResult = await supabase
        .from("events")
        .select("id, title, details, event_date, location, poster_url, created_at")
        .order("event_date", { ascending: true })
        .limit(6);

      if (eventsResult.error) {
        if (isMissingEventsTableError(eventsResult.error.message)) {
          warnings.push("Events table is missing. Run supabase/schema.sql to enable event manager and home event cards.");
        } else {
          setStatus(`Failed to load dashboard: ${eventsResult.error.message}`);
          return;
        }
      } else {
        eventRows = (eventsResult.data ?? []) as EventItem[];
      }

      let suggestionRows: EventSuggestion[] = [];
      const suggestionResult = await supabase
        .from("event_suggestions")
        .select("id, event_id, suggestion_text, created_at")
        .order("created_at", { ascending: true });

      if (suggestionResult.error) {
        if (isMissingEventSuggestionsTableError(suggestionResult.error.message)) {
          warnings.push("Event suggestions table is missing. Run supabase/schema.sql or supabase/patch_2026_03_29.sql to enable suggestions on Home.");
        } else {
          setStatus(`Failed to load dashboard: ${suggestionResult.error.message}`);
          return;
        }
      } else {
        suggestionRows = (suggestionResult.data ?? []) as EventSuggestion[];
      }

      setUsers(userRows);
      setAttendance(attendanceRows);
      setEvents(eventRows);
      setEventSuggestions(suggestionRows);
      if (eventRows.length > 0) {
        setSelectedEventId((prev) => prev ?? eventRows[0].id);
      }
      setStatus(warnings.length > 0 ? warnings.join(" ") : `Dashboard is live (${range.from} to ${range.to}).`);
    };

    void loadData();
  }, [range.from, range.to]);

  const userNetworkMap = useMemo(() => buildStudentNetworkMap(users), [users]);

  const analytics = useMemo(() => {
    const newcomerCount = users.filter((user) => user.newcomer).length;
    const newcomersScannedToday = attendance.filter((entry) => entry.was_newcomer).length;
    const byGroup = createEmptyNetworkCounts();
    const newcomerByGroup = createEmptyNetworkCounts();

    for (const scan of attendance) {
      const networkKey = userNetworkMap.get(scan.student_id);
      if (!networkKey) continue;
      byGroup[networkKey] += 1;
      if (scan.was_newcomer) newcomerByGroup[networkKey] += 1;
    }

    return {
      totalMembers: users.length,
      totalScansToday: attendance.length,
      activeNewcomers: newcomerCount,
      newcomersScannedToday,
      byGroup,
      newcomerByGroup
    };
  }, [attendance, userNetworkMap, users]);

  const timelineRows = useMemo(() => {
    const map = new Map<string, ReturnType<typeof createEmptyNetworkCounts>>();

    for (const scan of attendance) {
      if (scan.attended_date < MIN_ANALYTICS_DATE) continue;

      if (!map.has(scan.attended_date)) {
        map.set(scan.attended_date, createEmptyNetworkCounts());
      }

      const row = map.get(scan.attended_date);
      if (!row) continue;

      const networkKey = userNetworkMap.get(scan.student_id);
      if (!networkKey) continue;
      row[networkKey] += 1;
    }

    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-10)
      .map(([date, row]) => ({
        label: date.slice(5).replace("-", "/"),
        ...row
      }));
  }, [attendance, userNetworkMap]);

  const funnelSteps = useMemo(() => {
    const studentScanCounts = new Map<string, number>();

    for (const scan of attendance) {
      studentScanCounts.set(scan.student_id, (studentScanCounts.get(scan.student_id) ?? 0) + 1);
    }

    const scanned = studentScanCounts.size;
    const returning = Array.from(studentScanCounts.values()).filter((count) => count >= 2).length;
    const newcomerScanned = attendance.filter((scan) => scan.was_newcomer).length;

    return [
      { label: "Registered", value: users.length, color: "#334155" },
      { label: "Scanned (Range)", value: scanned, color: "#2563eb" },
      { label: "Returning (2+)", value: returning, color: "#10b981" },
      { label: "Newcomer Scans", value: newcomerScanned, color: "#f59e0b" }
    ];
  }, [attendance, users.length]);

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
      .select("id, event_id, suggestion_text, created_at")
      .single();

    if (error) {
      setSuggestionStatus(`Failed to add suggestion: ${error.message}`);
      return;
    }

    setEventSuggestions((prev) => [...prev, data as EventSuggestion]);
    setSuggestionInput("");
    setSuggestionStatus("Suggestion added.");
  };

  const savePoll = async (eventId: string) => {
    const question = pollQuestionInput.trim();
    const choices = Array.from(
      new Set(
        pollChoicesInput
          .split(/\n|,/)
          .map((item) => item.trim())
          .filter(Boolean)
      )
    );

    if (!question) {
      setSuggestionStatus("Poll question is required.");
      return;
    }

    if (choices.length < 2) {
      setSuggestionStatus("Add at least two poll choices.");
      return;
    }

    const stalePollIds = selectedEventSuggestions
      .filter((item) => item.suggestion_text.startsWith(POLL_QUESTION_PREFIX) || item.suggestion_text.startsWith(POLL_CHOICE_PREFIX))
      .map((item) => item.id);

    if (stalePollIds.length > 0) {
      const deleteResult = await supabase.from("event_suggestions").delete().in("id", stalePollIds);
      if (deleteResult.error) {
        setSuggestionStatus(`Failed to replace previous poll: ${deleteResult.error.message}`);
        return;
      }
    }

    const payload = [
      { event_id: eventId, suggestion_text: `${POLL_QUESTION_PREFIX}${question}` },
      ...choices.map((choice) => ({ event_id: eventId, suggestion_text: `${POLL_CHOICE_PREFIX}${choice}` }))
    ];

    const { data, error } = await supabase
      .from("event_suggestions")
      .insert(payload)
      .select("id, event_id, suggestion_text, created_at");

    if (error) {
      setSuggestionStatus(`Failed to save poll: ${error.message}`);
      return;
    }

    setEventSuggestions((prev) => [
      ...prev.filter((item) => !stalePollIds.includes(item.id)),
      ...((data ?? []) as EventSuggestion[])
    ]);
    setPollQuestionInput("");
    setPollChoicesInput("");
    setSuggestionStatus("Poll saved for this event.");
  };

  const removeSuggestion = async (suggestionId: string) => {
    const { error } = await supabase.from("event_suggestions").delete().eq("id", suggestionId);
    if (error) {
      setSuggestionStatus(`Failed to remove suggestion: ${error.message}`);
      return;
    }

    setEventSuggestions((prev) => prev.filter((item) => item.id !== suggestionId));
    setSuggestionStatus("Suggestion removed.");
  };

  return (
    <div className="space-y-8 reveal">
      <section className="card overflow-hidden bg-gradient-to-br from-[#f7fbf9] to-[#ecf3f0]">
        <div className="section-head">
          <div>
            <h1 className="page-title font-[var(--font-heading)]">Home Dashboard</h1>
            <p className="page-subtitle mt-2">Live analytics and event highlights from Supabase.</p>
          </div>
          <Link href="/events-manager" className="btn-primary">
            Manage Events
          </Link>
        </div>
        <div className="status-info mt-4">{status}</div>
      </section>

      <section className="analytics-strip">
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Members</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">{analytics.totalMembers}</p>
        </article>
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Scans Today</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">{analytics.totalScansToday}</p>
        </article>
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Active Newcomers</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">{analytics.activeNewcomers}</p>
        </article>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setAnalyticsView("mix")} className={analyticsView === "mix" ? "btn-primary" : "btn-ghost"}>Network Attendance</button>
            <button type="button" onClick={() => setAnalyticsView("funnel")} className={analyticsView === "funnel" ? "btn-primary" : "btn-ghost"}>Funnel</button>
          </div>

          {analyticsView === "mix" ? (
            <StackedPercentageChart title="Daily Network Attendance" rows={timelineRows} emptyText="No network attendance data yet." />
          ) : null}

          {analyticsView === "funnel" ? (
            <AnalyticsFunnel title="Attendance Funnel" steps={funnelSteps} emptyText="No funnel data yet." />
          ) : null}
        </section>

        <div className="space-y-6">
          <SimpleBarChart
            title="Newcomer Attendance by Network"
            items={[
              { label: NETWORK_LABELS.kidsMinistry, value: analytics.newcomerByGroup.kidsMinistry, color: GROUP_COLORS.kidsMinistry },
              { label: NETWORK_LABELS.youthMinistry, value: analytics.newcomerByGroup.youthMinistry, color: GROUP_COLORS.youthMinistry },
              { label: NETWORK_LABELS.youngProfessionals, value: analytics.newcomerByGroup.youngProfessionals, color: GROUP_COLORS.youngProfessionals },
              { label: NETWORK_LABELS.mensNetwork, value: analytics.newcomerByGroup.mensNetwork, color: GROUP_COLORS.mensNetwork },
              { label: NETWORK_LABELS.womensNetwork, value: analytics.newcomerByGroup.womensNetwork, color: GROUP_COLORS.womensNetwork }
            ]}
            emptyText="No newcomer network attendance yet."
          />
        </div>
      </div>

      <section className="analytics-panel">
        <div className="section-head">
          <h2 className="font-[var(--font-heading)] text-xl text-[#21312b]">Upcoming Events</h2>
        </div>
        {events.length === 0 ? (
          <p className="mt-4 text-sm text-[#5a7268]">No events yet. Add events in the Event Manager page.</p>
        ) : (
          <>
            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => (
              <article
                key={event.id}
                onClick={() => setSelectedEventId(event.id)}
                className={`cursor-pointer rounded-2xl border p-3 shadow-[0_8px_18px_rgba(56,91,79,0.09)] transition-all ${
                  selectedEventId === event.id ? "border-[#7fa899] bg-[#ecf4f1]" : "border-[#bfd0c9] bg-white/80"
                }`}
              >
                {event.poster_url ? (
                  <div className="relative h-36 w-full overflow-hidden rounded-xl">
                    <Image src={event.poster_url} alt={event.title} fill className="object-cover" sizes="(max-width: 1024px) 100vw, 33vw" />
                  </div>
                ) : (
                  <div className="flex h-36 w-full items-center justify-center rounded-xl bg-[#dce6e2] text-xs font-semibold text-[#4a665a]">
                    No Poster
                  </div>
                )}
                <h3 className="mt-3 font-[var(--font-heading)] text-lg text-[#263831]">{event.title}</h3>
                <p className="mt-1 text-xs text-[#577067]">
                  {event.event_date ?? "No date"}
                  {event.location ? ` • ${event.location}` : ""}
                </p>
                {event.details ? <p className="mt-2 text-sm text-[#3e5850] line-clamp-2">{event.details}</p> : null}
              </article>
            ))}
            </div>

            <div className="mt-5 rounded-2xl border border-[#aac1b8] bg-gradient-to-br from-[#f8fcfa] to-[#eef5f2] p-5 shadow-[0_10px_24px_rgba(56,91,79,0.08)]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-[var(--font-heading)] text-xl text-[#23332d]">Event Details and Suggestions</h3>
                {selectedEvent ? (
                  <span className="rounded-full border border-[#afc4bc] bg-white/85 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#406357]">
                    Active Event
                  </span>
                ) : null}
              </div>
              {!selectedEvent ? (
                <p className="mt-2 text-sm text-[#4f675e]">Click an event card to view details and suggestions.</p>
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

                  <div className="rounded-2xl border border-[#bdd0c9] bg-white p-4 shadow-[0_8px_18px_rgba(56,91,79,0.06)]">
                    <p className="text-sm font-semibold text-[#35564a]">Event Poll Builder</p>
                    <form
                      className="mt-3 space-y-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void savePoll(selectedEvent.id);
                      }}
                    >
                      <input
                        className="field-input"
                        value={pollQuestionInput}
                        onChange={(event) => setPollQuestionInput(event.target.value)}
                        placeholder="Poll question (e.g. What should we focus on next event?)"
                      />
                      <textarea
                        className="field-input min-h-[88px]"
                        value={pollChoicesInput}
                        onChange={(event) => setPollChoicesInput(event.target.value)}
                        placeholder={"Choices (comma-separated or one per line)\nExample:\nPrayer\nNetworking\nGames"}
                      />
                      <button type="submit" className="btn-primary md:min-w-[120px]">
                        Save Poll
                      </button>
                    </form>
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
                      onChange={(e) => setSuggestionInput(e.target.value)}
                      placeholder="Type a suggestion for this event..."
                    />
                    <button type="submit" className="btn-primary md:min-w-[120px]">
                      Add Suggestion
                    </button>
                  </form>

                  {suggestionStatus ? <p className="text-xs font-semibold text-[#49675c]">{suggestionStatus}</p> : null}

                  {selectedEventPollQuestion ? (
                    <div className="rounded-xl border border-[#cbd8d3] bg-white px-3 py-3 text-sm text-[#2f4d43] shadow-[0_4px_10px_rgba(56,91,79,0.05)]">
                      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#577067]">Current Poll</p>
                      <div className="mt-1 flex items-start justify-between gap-3">
                        <p className="font-semibold text-[#294a3e]">{selectedEventPollQuestion.suggestion_text.replace(POLL_QUESTION_PREFIX, "")}</p>
                        <button type="button" className="rounded-full border border-[#d9b6ba] px-3 py-1 text-xs font-semibold text-[#8a3f46] transition hover:bg-[#fff3f4]" onClick={() => void removeSuggestion(selectedEventPollQuestion.id)}>
                          Remove
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {selectedEventPollChoices.length === 0 ? (
                          <p className="text-xs text-[#5e766c]">No choices added yet.</p>
                        ) : (
                          selectedEventPollChoices.map((item) => (
                            <div key={item.id} className="inline-flex items-center gap-2 rounded-full border border-[#bfd0c9] bg-[#f4faf7] px-3 py-1 text-xs">
                              <span>{item.suggestion_text.replace(POLL_CHOICE_PREFIX, "")}</span>
                              <button type="button" className="font-semibold text-[#8a3f46]" onClick={() => void removeSuggestion(item.id)}>
                                x
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    {selectedEventOtherSuggestions.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-[#bdcec8] bg-white/70 px-3 py-2 text-sm text-[#5e766c]">
                        No suggestions yet for this event.
                      </p>
                    ) : (
                      selectedEventOtherSuggestions.map((item) => (
                        <div key={item.id} className="flex items-center justify-between rounded-xl border border-[#cbd8d3] bg-white px-3 py-2 text-sm text-[#2f4d43] shadow-[0_4px_10px_rgba(56,91,79,0.05)]">
                          <span>{item.suggestion_text}</span>
                          <button type="button" className="rounded-full border border-[#d9b6ba] px-3 py-1 text-xs font-semibold text-[#8a3f46] transition hover:bg-[#fff3f4]" onClick={() => void removeSuggestion(item.id)}>
                            Remove
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
