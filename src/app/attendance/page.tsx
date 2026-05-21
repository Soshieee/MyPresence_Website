"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Webcam from "react-webcam";
import Link from "next/link";
import * as faceapi from "face-api.js";
import { getFaceDetectorOptions, loadFaceApiModels } from "@/lib/faceApi";
import { hasSupabaseEnv, supabase, supabaseEnvIssue } from "@/lib/supabase";
import { AttendanceLog, EventItem, UserFace } from "@/types";
import { loadAppSettings } from "@/lib/app-settings";
import { extractLivenessMetrics, LivenessGate } from "@/lib/liveness";
import SimpleBarChart from "@/components/simple-bar-chart";
import { GROUP_COLORS } from "@/lib/analytics-colors";
import { NETWORK_LABELS, buildStudentNetworkMap, createEmptyNetworkCounts } from "@/lib/networks";

type ScannerStatusType = "info" | "success" | "error";
type AttendanceContext = "Sunday Service" | "Events";
type AttendanceGroup = "First Service" | "Second Service" | "Prayer Meeting" | "Rooftop" | "Men's Network" | "Women's Network";
type DetectionWithDescriptor = {
  descriptor: Float32Array;
  landmarks: {
    getLeftEye?: () => Array<{ x: number; y: number }>;
    getRightEye?: () => Array<{ x: number; y: number }>;
    getNose?: () => Array<{ x: number; y: number }>;
  };
  detection: { box: { x: number; width: number } };
};

const contextOptions: AttendanceContext[] = ["Sunday Service", "Events"];

const groupOptions: Record<AttendanceContext, AttendanceGroup[]> = {
  "Sunday Service": ["First Service", "Second Service", "Prayer Meeting"],
  Events: ["Rooftop", "Men's Network", "Women's Network"]
};

function normalizeAttendanceGroup(label: string | null) {
  if (label === "Male") return "Men's Network";
  if (label === "Female") return "Women's Network";
  return label;
}

const EVENT_ATTENDANCE_GROUPS: Array<{ label: AttendanceGroup; color: string }> = [
  { label: "First Service", color: "#2563eb" },
  { label: "Second Service", color: "#0ea5e9" },
  { label: "Prayer Meeting", color: "#f59e0b" },
  { label: "Rooftop", color: "#8b5cf6" },
  { label: "Men's Network", color: "#10b981" },
  { label: "Women's Network", color: "#ef4444" }
];

const FACE_DISTANCE_THRESHOLD = 0.42;
const FACE_AMBIGUITY_GAP = 0.04;
const MATCH_CONFIRMATION_FRAMES = 3;
const MIN_FACE_BOX_WIDTH_PX = 140;
const AUTO_MARK_COOLDOWN_MS = 8000;
const LIVENESS_TIMEOUT_MS = 12000;
const NO_FACE_RESET_MS = 5000;
const STATUS_COOLDOWN_MS = 1200;

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function isMissingClassificationColumnError(message: string) {
  return /column\s+attendance\.(was_newcomer|attendance_context|attendance_group|event_id)\s+does not exist/i.test(message);
}

function isMissingEventsTableError(message: string) {
  return /Could not find the table 'public\.events'|relation\s+"?events"?\s+does not exist/i.test(message);
}

function makeAttendanceKey(studentId: string, date: string, context: AttendanceContext, group: AttendanceGroup, eventId: string | null) {
  return `${studentId}|${date}|${context}|${group}|${eventId ?? "none"}`;
}

function isTransientSupabaseError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const payload = error as { message?: string; status?: number; code?: string };
  const message = payload.message?.toLowerCase() ?? "";
  const status = payload.status ?? 0;

  return (
    status === 0 ||
    status === 429 ||
    status >= 500 ||
    payload.code === "ECONNRESET" ||
    payload.code === "ETIMEDOUT" ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("fetch")
  );
}

async function withSupabaseRetry<T>(action: () => PromiseLike<T>, attempts = 3) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await action();
    } catch (err) {
      lastError = err;
      if (!isTransientSupabaseError(err) || attempt === attempts - 1) {
        throw err;
      }
      const delay = 500 + attempt * 700;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

export default function AttendancePage() {
  const webcamRef = useRef<Webcam | null>(null);
  const attendanceMarkedRef = useRef<Set<string>>(new Set());
  const scanInProgressRef = useRef(false);
  const stableMatchRef = useRef<{ key: string; frames: number }>({ key: "", frames: 0 });
  const autoMarkCooldownRef = useRef<Map<string, number>>(new Map());
  const livenessGateRef = useRef(new LivenessGate());
  const noFaceSinceRef = useRef<number | null>(null);
  const lastStatusRef = useRef<{ type: ScannerStatusType; message: string; at: number } | null>(null);

  const [statusType, setStatusType] = useState<ScannerStatusType>("info");
  const [statusMessage, setStatusMessage] = useState("Loading models and known face descriptors...");
  const [isReady, setIsReady] = useState(false);
  const [users, setUsers] = useState<UserFace[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [todayLogs, setTodayLogs] = useState<AttendanceLog[]>([]);
  const [selectedDate, setSelectedDate] = useState(getTodayIsoDate());
  const [newcomerClearCount, setNewcomerClearCount] = useState<1 | 2>(2);
  const [selectedContext, setSelectedContext] = useState<AttendanceContext | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<AttendanceGroup | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [latestMatch, setLatestMatch] = useState<{ name: string; studentId: string; context: AttendanceContext; group: AttendanceGroup } | null>(null);
  const [cameraFacingMode, setCameraFacingMode] = useState<"user" | "environment">("user");

  const statusClass = useMemo(() => {
    if (statusType === "success") return "status-success";
    if (statusType === "error") return "status-error";
    return "status-info";
  }, [statusType]);

  const knownDescriptors = useMemo(
    () =>
      users
        .filter((u) => Array.isArray(u.descriptor) && u.descriptor.length > 0)
        .map((u) => ({ user: u, descriptor: new Float32Array(u.descriptor) })),
    [users]
  );

  const analytics = useMemo(() => {
    const userNetworkMap = buildStudentNetworkMap(users);
    const base = createEmptyNetworkCounts();
    const newcomerBase = createEmptyNetworkCounts();

    for (const log of todayLogs) {
      const key = userNetworkMap.get(log.student_id);
      if (!key) continue;
      base[key] += 1;
      if (log.was_newcomer) newcomerBase[key] += 1;
    }

    return {
      scansToday: todayLogs.length,
      newcomersToday: todayLogs.filter((log) => log.was_newcomer).length,
      byGroup: base,
      newcomerByGroup: newcomerBase
    };
  }, [todayLogs, users]);

  const eventAttendanceCounts = useMemo(() => {
    const counts: Record<AttendanceGroup, number> = {
      "First Service": 0,
      "Second Service": 0,
      "Prayer Meeting": 0,
      Rooftop: 0,
      "Men's Network": 0,
      "Women's Network": 0
    };

    for (const log of todayLogs) {
      const group = normalizeAttendanceGroup(log.attendance_group) as AttendanceGroup | null;
      if (!group || !(group in counts)) continue;
      counts[group] += 1;
    }

    return EVENT_ATTENDANCE_GROUPS.map((entry) => ({
      label: entry.label,
      value: counts[entry.label],
      color: entry.color
    }));
  }, [todayLogs]);

  const loadLogsForDate = useCallback(async (date: string) => {
    let attendanceRows: AttendanceLog[] = [];

    const attendanceResult = await withSupabaseRetry(() =>
      supabase
        .from("attendance")
        .select("id, student_id, full_name, was_newcomer, attendance_context, attendance_group, event_id, attended_date, attended_at")
        .eq("attended_date", date)
    );

    if (attendanceResult.error) {
      if (isMissingClassificationColumnError(attendanceResult.error.message)) {
        const fallback = await supabase
          .from("attendance")
          .select("id, student_id, full_name, was_newcomer, attended_date, attended_at")
          .eq("attended_date", date);

        if (fallback.error) throw fallback.error;

        attendanceRows = ((fallback.data ?? []) as Array<Omit<AttendanceLog, "was_newcomer" | "attendance_context" | "attendance_group">>).map((row) => ({
          ...row,
          was_newcomer: false,
          attendance_context: null,
          attendance_group: null,
          event_id: null
        }));
      } else {
        throw attendanceResult.error;
      }
    } else {
      attendanceRows = (attendanceResult.data ?? []) as AttendanceLog[];
    }

    attendanceMarkedRef.current = new Set(
      attendanceRows
        .filter((row) => row.attendance_context && row.attendance_group)
        .map((row) =>
          makeAttendanceKey(
            row.student_id,
            row.attended_date,
            row.attendance_context as AttendanceContext,
            normalizeAttendanceGroup(row.attendance_group) as AttendanceGroup,
            row.event_id ?? null
          )
        )
    );
    setTodayLogs(attendanceRows);
  }, []);

  useEffect(() => {
    let mounted = true;

    const initialize = async () => {
      try {
        if (!hasSupabaseEnv) {
          setStatusType("error");
          setStatusMessage(supabaseEnvIssue ?? "Missing Supabase env values. Update .env.local and restart dev server.");
          return;
        }

        await loadFaceApiModels();
        const settings = loadAppSettings();
        setNewcomerClearCount(settings.newcomerClearScanCount);

        const usersResult = await supabase
          .from("users")
          .select("id, student_id, full_name, age, gender, newcomer, descriptor, created_at");

        if (usersResult.error) throw usersResult.error;

        const eventsResult = await supabase
          .from("events")
          .select("id, title, details, event_date, location, poster_url, created_at")
          .order("event_date", { ascending: true });

        if (!eventsResult.error) {
          setEvents((eventsResult.data ?? []) as EventItem[]);
        } else if (!isMissingEventsTableError(eventsResult.error.message)) {
          throw eventsResult.error;
        }

        await loadLogsForDate(getTodayIsoDate());

        if (mounted) {
          setUsers((usersResult.data ?? []) as UserFace[]);
          setIsReady(true);
          setStatusType("info");
          setStatusMessage("Select attendance type, group, date, and optional event before scanning.");
        }
      } catch (err: unknown) {
        console.error(err);
        if (mounted) {
          setStatusType("error");
          const errorMessage = err instanceof Error ? err.message : "Unknown error";
          setStatusMessage(`Failed to initialize scanner: ${errorMessage}`);
        }
      }
    };

    void initialize();

    return () => {
      mounted = false;
    };
  }, [loadLogsForDate]);

  useEffect(() => {
    if (!isReady) return;

    void loadLogsForDate(selectedDate).catch((err: unknown) => {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setStatusType("error");
      setStatusMessage(`Failed to load attendance for date: ${errorMessage}`);
    });
  }, [isReady, loadLogsForDate, selectedDate]);

  const markAttendance = useCallback(async (studentId: string, fullName: string) => {
    if (!selectedContext || !selectedGroup) {
      setStatusType("error");
      setStatusMessage("Select attendance type and group before scanning.");
      return;
    }

    if (selectedContext === "Events" && !selectedEventId) {
      setStatusType("error");
      setStatusMessage("Select an event for Events attendance before scanning.");
      return;
    }

    const attendanceDate = selectedDate;
    const matchedUser = users.find((user) => user.student_id === studentId);
    const wasNewcomer = Boolean(matchedUser?.newcomer);
    const eventIdForScan = selectedContext === "Events" ? selectedEventId : null;
    const attendanceKey = makeAttendanceKey(studentId, attendanceDate, selectedContext, selectedGroup, eventIdForScan);

    if (attendanceMarkedRef.current.has(attendanceKey)) {
      setStatusType("info");
      setStatusMessage(`${fullName} is already marked for ${selectedGroup} today.`);
      setLatestMatch({ name: fullName, studentId, context: selectedContext, group: selectedGroup });
      return;
    }

    const { error } = await withSupabaseRetry(() =>
      supabase.from("attendance").insert({
        student_id: studentId,
        full_name: fullName,
        was_newcomer: wasNewcomer,
        attendance_context: selectedContext,
        attendance_group: selectedGroup,
        event_id: eventIdForScan,
        attended_date: attendanceDate,
        attended_at: new Date().toISOString()
      })
    );

    if (error) {
      if (error.code === "23505") {
        attendanceMarkedRef.current.add(attendanceKey);
        setStatusType("info");
        setStatusMessage(`${fullName} is already marked for ${selectedGroup} today.`);
        setLatestMatch({ name: fullName, studentId, context: selectedContext, group: selectedGroup });
        return;
      }

      throw error;
    }

    attendanceMarkedRef.current.add(attendanceKey);
    setTodayLogs((prev) => [
      {
        id: crypto.randomUUID(),
        student_id: studentId,
        full_name: fullName,
        was_newcomer: wasNewcomer,
        attendance_context: selectedContext,
        attendance_group: selectedGroup,
        event_id: eventIdForScan,
        attended_date: attendanceDate,
        attended_at: new Date().toISOString()
      },
      ...prev
    ]);

    const { count, error: countError } = await supabase
      .from("attendance")
      .select("id", { count: "exact", head: true })
      .eq("student_id", studentId);

    if (!countError && matchedUser?.newcomer && (count ?? 0) >= newcomerClearCount) {
      const { error: userUpdateError } = await supabase
        .from("users")
        .update({ newcomer: false })
        .eq("student_id", studentId);

      if (!userUpdateError) {
        setUsers((prev) =>
          prev.map((user) => (user.student_id === studentId ? { ...user, newcomer: false } : user))
        );
      }
    }

    setStatusType("success");
    setStatusMessage(`Attendance marked for ${fullName} in ${selectedGroup}.`);
    setLatestMatch({ name: fullName, studentId, context: selectedContext, group: selectedGroup });
  }, [newcomerClearCount, selectedContext, selectedDate, selectedEventId, selectedGroup, users]);

  useEffect(() => {
    if (!isReady || users.length === 0) {
      if (isReady && users.length === 0) {
        setStatusType("error");
        setStatusMessage("No registered users found. Register users first.");
      }
      return;
    }

    livenessGateRef.current.reset();

    if (!selectedContext || !selectedGroup) {
      setStatusType("info");
      setStatusMessage("Select attendance type and group before scanning.");
      return;
    }

    if (selectedContext === "Events" && !selectedEventId) {
      setStatusType("info");
      setStatusMessage("Select an event for Events attendance before scanning.");
      return;
    }

    if (knownDescriptors.length === 0) {
      setStatusType("error");
      setStatusMessage("No valid descriptors found. Re-register users.");
      return;
    }

    const setStatus = (type: ScannerStatusType, message: string) => {
      const now = Date.now();
      const last = lastStatusRef.current;
      const shouldUpdate =
        !last ||
        last.type !== type ||
        last.message !== message ||
        now - last.at > STATUS_COOLDOWN_MS;

      if (shouldUpdate) {
        lastStatusRef.current = { type, message, at: now };
        setStatusType(type);
        setStatusMessage(message);
      }
    };

    const interval = setInterval(() => {
      if (scanInProgressRef.current) return;

      const video = webcamRef.current?.video as HTMLVideoElement | undefined;
      if (!video || video.readyState < 2) {
        setStatus("info", "Waiting for camera feed...");
        return;
      }

      scanInProgressRef.current = true;

      faceapi
        .detectAllFaces(video, getFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptors()
        .then(async (detections: DetectionWithDescriptor[]) => {
          if (detections.length === 0) {
            stableMatchRef.current = { key: "", frames: 0 };
            livenessGateRef.current.reset();
            const now = Date.now();
            if (!noFaceSinceRef.current) {
              noFaceSinceRef.current = now;
            }
            if (noFaceSinceRef.current && now - noFaceSinceRef.current > NO_FACE_RESET_MS) {
              noFaceSinceRef.current = now;
            }
            setStatus("info", "No face detected.");
            return;
          }

          if (detections.length > 1) {
            stableMatchRef.current = { key: "", frames: 0 };
            livenessGateRef.current.reset();
            noFaceSinceRef.current = null;
            setStatus("error", "Multiple faces detected. Please keep one face visible.");
            return;
          }

          const detection = detections[0];
          if (detection.detection.box.width < MIN_FACE_BOX_WIDTH_PX) {
            stableMatchRef.current = { key: "", frames: 0 };
            livenessGateRef.current.reset();
            noFaceSinceRef.current = null;
            setStatus("info", "Face is too far. Move closer to the camera.");
            return;
          }

          noFaceSinceRef.current = null;

          const metrics = extractLivenessMetrics(detection.landmarks, detection.detection.box);
          if (!metrics) {
            setStatus("info", "Hold still so liveness can be verified.");
            return;
          }

          const gate = livenessGateRef.current;
          gate.update(metrics);
          if (!gate.hasPassed()) {
            if (gate.getElapsedMs() > LIVENESS_TIMEOUT_MS) {
              gate.reset();
            }
            setStatus("info", "Liveness check: blink and gently turn your head.");
            return;
          }

          const ranked = knownDescriptors
            .map((entry) => ({
              ...entry,
              distance: faceapi.euclideanDistance(detection.descriptor, entry.descriptor)
            }))
            .sort((a, b) => a.distance - b.distance);

          const best = ranked[0];
          const second = ranked[1];

          if (!best || best.distance > FACE_DISTANCE_THRESHOLD) {
            stableMatchRef.current = { key: "", frames: 0 };
            livenessGateRef.current.reset();
            setStatus("error", "Low confidence match. Try moving closer to camera.");
            return;
          }

          if (second && second.distance - best.distance < FACE_AMBIGUITY_GAP) {
            stableMatchRef.current = { key: "", frames: 0 };
            livenessGateRef.current.reset();
            setStatus("error", "Ambiguous match detected. Hold still and face the camera directly.");
            return;
          }

          const matchKey = `${best.user.student_id}|${best.user.full_name}`;
          if (stableMatchRef.current.key === matchKey) {
            stableMatchRef.current.frames += 1;
          } else {
            stableMatchRef.current = { key: matchKey, frames: 1 };
          }

          if (stableMatchRef.current.frames < MATCH_CONFIRMATION_FRAMES) {
            setStatus("info", `Matched ${best.user.full_name}. Hold steady for auto-save...`);
            return;
          }

          const eventIdForScan = selectedContext === "Events" ? selectedEventId : null;
          const scanKey = makeAttendanceKey(
            best.user.student_id,
            selectedDate,
            selectedContext,
            selectedGroup,
            eventIdForScan
          );
          const now = Date.now();
          const lastMarkTs = autoMarkCooldownRef.current.get(scanKey) ?? 0;
          if (now - lastMarkTs < AUTO_MARK_COOLDOWN_MS) {
            return;
          }

          autoMarkCooldownRef.current.set(scanKey, now);
          setStatus("info", `Matched ${best.user.full_name}. Saving attendance automatically...`);
          await markAttendance(best.user.student_id, best.user.full_name);
          livenessGateRef.current.reset();
        })
        .catch((err: unknown) => {
          console.error(err);
          setStatus("error", "Error during face scan.");
        })
        .finally(() => {
          scanInProgressRef.current = false;
        });
    }, 1200);

    return () => {
      clearInterval(interval);
    };
  }, [isReady, knownDescriptors, markAttendance, selectedContext, selectedDate, selectedEventId, selectedGroup, users.length]);

  return (
    <div className="space-y-6 reveal">
      <section>
        <h1 className="page-title font-[var(--font-heading)]">Attendance Scanning</h1>
        <p className="page-subtitle">Select the active service/event group, then scan faces in real time.</p>
      </section>

      {!hasSupabaseEnv ? (
        <div className="card status-error">
          Supabase environment values are missing. Update <span className="font-semibold">.env.local</span> and restart the dev server.
        </div>
      ) : null}

      {isReady && users.length === 0 ? (
        <div className="card status-info">
          No registered users yet. Go to <Link href="/register" className="font-semibold underline">User Registration</Link> to add members.
        </div>
      ) : null}

      {selectedContext === "Events" && events.length === 0 ? (
        <div className="card status-info">
          No events found. Create one in <Link href="/events-manager" className="font-semibold underline">Event Manager</Link> to link event attendance.
        </div>
      ) : null}

      <section className="card scan-focus-panel space-y-4">
        <p className="rounded-xl border border-[#98b6aa] bg-[#e7f1ed] px-4 py-3 text-base font-semibold text-[#25493e] md:text-lg">
          Select attendance type and group before scanning.
        </p>

        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <p className="field-label">Attendance Date</p>
            <input
              type="date"
              className="field-input max-w-[220px]"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
            />
          </div>
          <button type="button" className="btn-ghost w-fit" onClick={() => setSelectedDate(getTodayIsoDate())}>
            Use Today
          </button>
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="field-label mb-0">Attendance Type</p>
          <span className="rounded-full border border-[#9bb6ad] bg-[#edf5f2] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#2f5145]">
            Required Before Scan
          </span>
        </div>

        <div>
          <div className="flex flex-wrap gap-2">
            {contextOptions.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setSelectedContext(option);
                  setSelectedGroup(null);
                  setSelectedEventId(null);
                }}
                className={selectedContext === option ? "btn-primary" : "btn-ghost"}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="field-label">Group</p>
          <div className="flex flex-wrap gap-2">
            {(selectedContext ? groupOptions[selectedContext] : []).map((group) => (
              <button
                key={group}
                type="button"
                onClick={() => setSelectedGroup(group)}
                className={selectedGroup === group ? "btn-primary" : "btn-ghost"}
              >
                {group}
              </button>
            ))}
          </div>
          {!selectedContext ? <p className="mt-2 text-xs text-[#5f756c]">Choose attendance type first.</p> : null}
          {selectedContext && !selectedGroup ? <p className="mt-2 text-xs font-semibold text-[#35584c]">Now select a group to activate scanner.</p> : null}
        </div>

        {selectedContext === "Events" ? (
          <div>
            <p className="field-label">Linked Event</p>
            {events.length === 0 ? (
              <p className="text-xs text-[#5f756c]">No events found. Create one in Event Manager first.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {events.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => setSelectedEventId(event.id)}
                    className={selectedEventId === event.id ? "btn-primary" : "btn-ghost"}
                    title={event.event_date ?? "No date"}
                  >
                    {event.title}
                  </button>
                ))}
              </div>
            )}
            {!selectedEventId ? <p className="mt-2 text-xs font-semibold text-[#35584c]">Select an event to link scanned attendance.</p> : null}
          </div>
        ) : null}

        <p className="text-xs text-[#4f675e]">
          Auto-save is active. Keep one clear face in frame and attendance will be saved automatically.
        </p>
      </section>

      <section className="analytics-strip">
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Mode</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">Fast Scan</p>
        </article>
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Selected Group</p>
          <p className="mt-2 font-[var(--font-heading)] text-xl text-[#22322d]">{selectedGroup ?? "None"}</p>
        </article>
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Linked Event</p>
          <p className="mt-2 font-[var(--font-heading)] text-xl text-[#22322d]">
            {selectedContext === "Events" ? (events.find((event) => event.id === selectedEventId)?.title ?? "None") : "N/A"}
          </p>
        </article>
      </section>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="card bg-[#f8fbfa]">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#5a776b]">Live Attendance Feed</p>
            <button
              type="button"
              className="btn-ghost px-3 py-1.5 text-xs"
              onClick={() => setCameraFacingMode((prev) => (prev === "user" ? "environment" : "user"))}
            >
              Flip Camera
            </button>
          </div>
          <Webcam
            ref={webcamRef}
            audio={false}
            screenshotFormat="image/jpeg"
            onUserMediaError={() => {
              setStatusType("error");
              setStatusMessage("Camera permission denied or unavailable.");
            }}
            videoConstraints={{
              facingMode: cameraFacingMode,
              width: 960,
              height: 720
            }}
            className="h-auto w-full rounded-xl border border-[#b9c8c2] shadow-[0_12px_26px_rgba(56,91,79,0.16)]"
          />
          <div className="chart-frame h-24" />
        </div>

        <aside className="space-y-4">
          <div className="card space-y-3">
            <h2 className="font-[var(--font-heading)] text-lg text-[#23332d]">Scanner Status</h2>
            <div className={statusClass}>{statusMessage}</div>
            <p className="text-xs text-[#5f756c]">
              Distance threshold: {FACE_DISTANCE_THRESHOLD} • Stable frames: {MATCH_CONFIRMATION_FRAMES}
            </p>
          </div>

          <div className="card space-y-2">
            <h2 className="font-[var(--font-heading)] text-lg text-[#23332d]">Latest Match</h2>
            {latestMatch ? (
              <div className="rounded-xl border border-[#a7c3b8] bg-[#e8f3ef] p-3 text-sm text-[#2f5b4c]">
                <p className="font-semibold">{latestMatch.name}</p>
                <p>ID: {latestMatch.studentId}</p>
                <p>
                  {latestMatch.context} • {latestMatch.group}
                </p>
              </div>
            ) : (
              <p className="text-sm text-[#4e655d]">No successful match yet.</p>
            )}
          </div>
        </aside>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SimpleBarChart
          title={`Attendance by Network (Date: ${selectedDate}${selectedDate === getTodayIsoDate() ? " • Today" : ""})`}
          items={[
            { label: NETWORK_LABELS.kidsMinistry, value: analytics.byGroup.kidsMinistry, color: GROUP_COLORS.kidsMinistry },
            { label: NETWORK_LABELS.youthMinistry, value: analytics.byGroup.youthMinistry, color: GROUP_COLORS.youthMinistry },
            { label: NETWORK_LABELS.youngProfessionals, value: analytics.byGroup.youngProfessionals, color: GROUP_COLORS.youngProfessionals },
            { label: NETWORK_LABELS.mensNetwork, value: analytics.byGroup.mensNetwork, color: GROUP_COLORS.mensNetwork },
            { label: NETWORK_LABELS.womensNetwork, value: analytics.byGroup.womensNetwork, color: GROUP_COLORS.womensNetwork }
          ]}
        />
        <SimpleBarChart
          title="Newcomer Attendance by Network"
          items={[
            { label: NETWORK_LABELS.kidsMinistry, value: analytics.newcomerByGroup.kidsMinistry, color: GROUP_COLORS.kidsMinistry },
            { label: NETWORK_LABELS.youthMinistry, value: analytics.newcomerByGroup.youthMinistry, color: GROUP_COLORS.youthMinistry },
            { label: NETWORK_LABELS.youngProfessionals, value: analytics.newcomerByGroup.youngProfessionals, color: GROUP_COLORS.youngProfessionals },
            { label: NETWORK_LABELS.mensNetwork, value: analytics.newcomerByGroup.mensNetwork, color: GROUP_COLORS.mensNetwork },
            { label: NETWORK_LABELS.womensNetwork, value: analytics.newcomerByGroup.womensNetwork, color: GROUP_COLORS.womensNetwork }
          ]}
        />
        <SimpleBarChart
          title={`Event Attendance Breakdown (Date: ${selectedDate}${selectedDate === getTodayIsoDate() ? " • Today" : ""})`}
          items={eventAttendanceCounts}
          emptyText="No event attendance data yet for selected date."
        />
      </div>
    </div>
  );
}
