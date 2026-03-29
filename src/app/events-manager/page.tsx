"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { hasSupabaseEnv, supabase, supabaseEnvIssue } from "@/lib/supabase";
import { EventItem } from "@/types";

function isMissingEventsTableError(message: string) {
  return /Could not find the table 'public\.events'|relation\s+"?events"?\s+does not exist/i.test(message);
}

export default function EventsManagerPage() {
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [location, setLocation] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [status, setStatus] = useState("Manage events and publish them to the home page.");
  const [loading, setLoading] = useState(false);

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

    setEvents((data ?? []) as EventItem[]);
  };

  useEffect(() => {
    void loadEvents();
  }, []);

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
          <h2 className="font-[var(--font-heading)] text-xl font-semibold text-[#23332d]">Recent Events</h2>
          <div className="mt-4 space-y-3">
            {events.length === 0 ? (
              <p className="text-sm text-[#4f675e]">No events yet.</p>
            ) : (
              events.map((item) => (
                <article key={item.id} className="rounded-xl border border-[#bfd0c9] bg-white/80 p-3">
                  <h3 className="font-semibold text-[#243730]">{item.title}</h3>
                  <p className="mt-1 text-xs text-[#5e766c]">{item.event_date ?? "No date"} {item.location ? `• ${item.location}` : ""}</p>
                  {item.details ? <p className="mt-1 text-sm text-[#3e5850] line-clamp-2">{item.details}</p> : null}
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
