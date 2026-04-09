"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { hasSupabaseEnv, supabase, supabaseEnvIssue } from "@/lib/supabase";
import { EventItem, EventSuggestion } from "@/types";

type EventAttendanceRow = {
  id: string;
  full_name: string;
  student_id: string;
  attended_at: string;
  attendance_group: string | null;
};

function isMissingEventsTableError(message: string) {
  return /Could not find the table 'public\.events'|relation\s+"?events"?\s+does not exist/i.test(message);
}

function isMissingEventSuggestionsTableError(message: string) {
  return /Could not find the table 'public\.event_suggestions'|relation\s+"?event_suggestions"?\s+does not exist/i.test(message);
}

function isMissingAttendanceEventIdError(message: string) {
  return /column\s+attendance\.event_id\s+does not exist/i.test(message);
}

export default function EventsManagerPage() {
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [location, setLocation] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventSuggestions, setEventSuggestions] = useState<EventSuggestion[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [suggestionInput, setSuggestionInput] = useState("");
  const [suggestionStatus, setSuggestionStatus] = useState("");
  const [selectedEventAttendance, setSelectedEventAttendance] = useState<EventAttendanceRow[]>([]);
  const [attendanceStatus, setAttendanceStatus] = useState("");
  const [status, setStatus] = useState("Manage events and publish them to the home page.");
  const [loading, setLoading] = useState(false);

  const defaultFoodSuggestions = ["Chicken", "Porkchop", "Barbecue"];

  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? null;

  useEffect(() => {
    if (!selectedEventId) {
      return;
    }

    const loadEventAttendance = async () => {
      const { data, error } = await supabase
        .from("attendance")
        .select("id, full_name, student_id, attended_at, attendance_group")
        .eq("event_id", selectedEventId)
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
    };

    const timeoutId = window.setTimeout(() => {
      void loadEventAttendance();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [selectedEventId]);

  const selectedEventSuggestions = selectedEventId
    ? eventSuggestions.filter((row) => row.event_id === selectedEventId)
    : [];

  const loadEvents = async () => {
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
      setSelectedEventId((prev) => prev ?? nextEvents[0].id);
    }
  };

  const loadSuggestions = async () => {
    if (!hasSupabaseEnv) return;

    const { data, error } = await supabase
      .from("event_suggestions")
      .select("id, event_id, suggestion_text, created_at")
      .order("created_at", { ascending: true });

    if (error) {
      if (isMissingEventSuggestionsTableError(error.message)) {
        setSuggestionStatus("Event suggestions table is missing. Run supabase/schema.sql to enable suggestions.");
        return;
      }

      setSuggestionStatus(`Failed to load suggestions: ${error.message}`);
      return;
    }

    setEventSuggestions((data ?? []) as EventSuggestion[]);
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadEvents();
      void loadSuggestions();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
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

  const removeSuggestion = async (suggestionId: string) => {
    const { error } = await supabase.from("event_suggestions").delete().eq("id", suggestionId);
    if (error) {
      setSuggestionStatus(`Failed to remove suggestion: ${error.message}`);
      return;
    }

    setEventSuggestions((prev) => prev.filter((item) => item.id !== suggestionId));
    setSuggestionStatus("Suggestion removed.");
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

    setLoading(true);
    const { error } = await supabase.from("events").insert({
      title: title.trim(),
      details: details.trim() || null,
      location: location.trim() || null,
      event_date: eventDate || null,
      poster_url: posterUrl
    });
    setLoading(false);

    if (error) {
      if (isMissingEventsTableError(error.message)) {
        setStatus("Cannot save event yet. Run supabase/schema.sql in Supabase SQL Editor first.");
        return;
      }

      setStatus(`Failed to save event: ${error.message}`);
      return;
    }

    setTitle("");
    setDetails("");
    setLocation("");
    setEventDate("");
    setPosterUrl(null);
    setStatus("Event saved successfully.");
    await loadEvents();
  };

  return (
    <div className="space-y-6 reveal">
      <section>
        <h1 className="page-title font-[var(--font-heading)]">Event Manager</h1>
        <p className="page-subtitle">Add posters and details. Published events appear on the home dashboard.</p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <form className="card space-y-4" onSubmit={onSubmit}>
          <div>
            <label className="field-label">Event Title</label>
            <input className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="field-label">Details</label>
            <textarea
              className="field-input min-h-24"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Description, schedule, notes"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="field-label">Location</label>
              <input className="field-input" value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <div>
              <label className="field-label">Event Date</label>
              <input className="field-input" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="field-label">Poster Image</label>
            <input className="field-input" type="file" accept="image/*" onChange={onPosterChange} />
          </div>
          {posterUrl ? (
            <img src={posterUrl} alt="Poster Preview" className="h-48 w-full rounded-xl border border-[#b9c8c2] object-cover" />
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
                  onClick={() => setSelectedEventId(item.id)}
                  className={`cursor-pointer rounded-xl border p-3 transition-all ${
                    selectedEventId === item.id
                      ? "border-[#7fa899] bg-[#ecf4f1] shadow-[0_8px_18px_rgba(56,91,79,0.1)]"
                      : "border-[#bfd0c9] bg-white/80"
                  }`}
                >
                  <h3 className="font-semibold text-[#243730]">{item.title}</h3>
                  <p className="mt-1 text-xs text-[#5e766c]">{item.event_date ?? "No date"} {item.location ? `• ${item.location}` : ""}</p>
                  {item.details ? <p className="mt-1 text-sm text-[#3e5850] line-clamp-2">{item.details}</p> : null}
                </article>
              ))
            )}
          </div>
        </section>
      </div>

      <section className="analytics-panel">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-[var(--font-heading)] text-xl text-[#23332d]">Event Details and Suggestions</h2>
          {selectedEvent ? (
            <span className="rounded-full border border-[#afc4bc] bg-white/85 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#406357]">
              Active Event
            </span>
          ) : null}
        </div>

        {!selectedEvent ? (
          <p className="mt-3 text-sm text-[#4f675e]">Click an event in Recent Events to view details and suggestions.</p>
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
                      <p className="text-xs font-semibold text-[#4f675e]">{new Date(row.attended_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-[#35564a]">Quick Food Suggestions</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {defaultFoodSuggestions.map((food) => (
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
                onChange={(e) => setSuggestionInput(e.target.value)}
                placeholder="Type a suggestion for this event..."
              />
              <button type="submit" className="btn-primary md:min-w-[120px]">
                Add Suggestion
              </button>
            </form>

            {suggestionStatus ? <p className="text-xs font-semibold text-[#49675c]">{suggestionStatus}</p> : null}

            <div className="space-y-2">
              {selectedEventSuggestions.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[#bdcec8] bg-white/70 px-3 py-2 text-sm text-[#5e766c]">
                  No suggestions yet for this event.
                </p>
              ) : (
                selectedEventSuggestions.map((item) => (
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
      </section>
    </div>
  );
}
