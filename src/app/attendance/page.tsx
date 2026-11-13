"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Webcam from "react-webcam";
import Link from "next/link";
import * as faceapi from "face-api.js";
import { getFaceDetectorOptions, loadFaceApiModels } from "@/lib/faceApi";
import { toLocalDateInput } from "@/lib/date";
import { hasSupabaseEnv, supabase, supabaseEnvIssue } from "@/lib/supabase";
import { AttendanceLog, EventItem, UserFace } from "@/types";
import { loadAppSettings } from "@/lib/app-settings";
import { extractLivenessMetrics, LivenessGate } from "@/lib/liveness";
import {
  KIOSK_BROADCAST_EVENT,
  KIOSK_CHANNEL,
  KIOSK_FRAME_EVENT,
  KIOSK_STATUS_EVENT,
  toKioskFirstName,
  toKioskStatusMessage,
  type KioskScanOutcome
} from "@/lib/kiosk";
import { createTickWorker, type TickWorker } from "@/lib/tick-worker";
import {
  ATTENDANCE_ERROR_MESSAGES,
  ATTENDANCE_TYPES,
  AttendanceType,
  attendanceGroupFor,
  compatibleEventTypes,
  describeAttendanceDbError,
  isEventCompatible,
  isMissingActiveColumnError,
  isMissingEventTypeColumnError,
  isMissingServiceTypeColumnError,
  normalizeAttendanceType,
  normalizeServiceType,
  SundaySession,
  SUNDAY_SESSIONS
} from "@/lib/attendance";

type ScannerStatusType = "info" | "success" | "error";
type DetectionWithDescriptor = {
  descriptor: Float32Array;
  landmarks: {
    getLeftEye?: () => Array<{ x: number; y: number }>;
    getRightEye?: () => Array<{ x: number; y: number }>;
    getNose?: () => Array<{ x: number; y: number }>;
  };
  detection: { box: { x: number; width: number } };
};

const FACE_DISTANCE_THRESHOLD = 0.42;
const FACE_AMBIGUITY_GAP = 0.04;
const MATCH_CONFIRMATION_FRAMES = 2;
// "Face is too far" gate, measured in video pixels. Scaled from 140 px at the
// previous 960-wide source to keep the same physical standing distance now
// that the camera runs at 1280 wide (140 × 1280/960 ≈ 187).
const MIN_FACE_BOX_WIDTH_PX = 187;
const AUTO_MARK_COOLDOWN_MS = 8000;
const LIVENESS_TIMEOUT_MS = 12000;
const NO_FACE_RESET_MS = 5000;
const STATUS_COOLDOWN_MS = 1200;
const SUNDAY_SERVICE_DUPLICATE_MESSAGE =
  "This user has already scanned for the Sunday Service for the day";

function getTodayIsoDate() {
  return toLocalDateInput(new Date());
}

function isMissingClassificationColumnError(message: string) {
  return /column\s+attendance\.(was_newcomer|attendance_context|attendance_group|event_id)\s+does not exist/i.test(message);
}

function isMissingEventsTableError(message: string) {
  return /Could not find the table 'public\.events'|relation\s+"?events"?\s+does not exist/i.test(message);
}

function makeAttendanceKey(studentId: string, date: string, context: AttendanceType, group: string) {
  // First and Second Service share one Sunday attendance record per date.
  if (context === "Sunday Service") {
    return `${studentId}|${date}|${context}`;
  }

  return `${studentId}|${date}|${context}|${group}`;
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
  const attendanceLoadedDateRef = useRef<string | null>(null);
  const scanInProgressRef = useRef(false);
  const stableMatchRef = useRef<{ key: string; frames: number }>({ key: "", frames: 0 });
  const autoMarkCooldownRef = useRef<Map<string, number>>(new Map());
  const livenessGateRef = useRef(new LivenessGate());
  const noFaceSinceRef = useRef<number | null>(null);
  const lastStatusRef = useRef<{ type: ScannerStatusType; message: string; at: number } | null>(null);
  const kioskChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const tickWorkerRef = useRef<TickWorker | null>(null);
  const scanTickRef = useRef<(() => void) | null>(null);
  const frameTickRef = useRef<(() => void) | null>(null);

  const [statusType, setStatusType] = useState<ScannerStatusType>("info");
  const [statusMessage, setStatusMessage] = useState("Loading models and known face descriptors...");
  const [isReady, setIsReady] = useState(false);
  const [users, setUsers] = useState<UserFace[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [, setTodayLogs] = useState<AttendanceLog[]>([]);
  const [selectedDate, setSelectedDate] = useState(getTodayIsoDate());
  const [newcomerClearCount, setNewcomerClearCount] = useState<1 | 2>(2);
  const [selectedContext, setSelectedContext] = useState<AttendanceType | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<SundaySession | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [latestMatch, setLatestMatch] = useState<{
    name: string;
    studentId: string;
    context: AttendanceType;
    group: string;
    session: string;
    eventTitle: string | null;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isMirrored, setIsMirrored] = useState(false);
  // Scanner operations are restricted to administrators. RLS remains the
  // server-side enforcement; this gate only controls the operator UI.
  const [adminState, setAdminState] = useState<"checking" | "allowed" | "denied">("checking");

  useEffect(() => {
    let active = true;
    const checkAdmin = async () => {
      if (!hasSupabaseEnv) {
        if (active) setAdminState("denied");
        return;
      }

      const { data, error } = await supabase.rpc("is_admin");
      if (!active) return;
      setAdminState(!error && data === true ? "allowed" : "denied");
    };

    void checkAdmin();
    return () => {
      active = false;
    };
  }, []);

  // P5 — kiosk display link: publish scan outcomes to the public display.
  useEffect(() => {
    if (!hasSupabaseEnv) return;
    const channel = supabase.channel(KIOSK_CHANNEL);
    channel.subscribe();
    kioskChannelRef.current = channel;
    return () => {
      kioskChannelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, []);

  const publishKioskScan = useCallback(
    (outcome: KioskScanOutcome, fullName: string, contextLabel: string | null) => {
      const channel = kioskChannelRef.current;
      if (!channel) return;
      void channel
        .send({
          type: "broadcast",
          event: KIOSK_BROADCAST_EVENT,
          payload: {
            outcome,
            firstName: toKioskFirstName(fullName),
            context: contextLabel ? contextLabel.slice(0, 60) : null,
            at: new Date().toISOString()
          }
        })
        .catch(() => {
          // Kiosk display is optional; delivery failures never block scanning.
        });
    },
    []
  );

  // Publish scanner status changes to the kiosk (sanitized for public display).
  const lastKioskStatusRef = useRef("");

  // Throttling-immune tick driver: background-tab timer throttling does not
  // apply to Web Workers, so scanning and kiosk streaming keep running while
  // the operator views the kiosk in another tab or window.
  useEffect(() => {
    const tick = createTickWorker(250);
    tickWorkerRef.current = tick;
    tick.worker.onmessage = () => {
      frameTickRef.current?.();
      scanTickRef.current?.();
    };
    return () => {
      tickWorkerRef.current = null;
      scanTickRef.current = null;
      frameTickRef.current = null;
      tick.dispose();
    };
  }, []);

  useEffect(() => {
    const message = toKioskStatusMessage(statusMessage);
    if (!message || message === lastKioskStatusRef.current) return;
    lastKioskStatusRef.current = message;
    const channel = kioskChannelRef.current;
    if (!channel) return;
    void channel
      .send({
        type: "broadcast",
        event: KIOSK_STATUS_EVENT,
        payload: { kind: statusType, message, at: new Date().toISOString() }
      })
      .catch(() => {
        // ignore
      });
  }, [statusMessage, statusType]);

  // Stream a downscaled live camera preview to the kiosk (~4 fps). The kiosk
  // never accesses the camera or biometric data — it only shows this stream.
  const kioskMirrorRef = useRef(isMirrored);
  // Mirror preference is kept outside the render phase: the kiosk frame tick
  // below is registered once and reads the ref each time it fires, so this
  // effect keeps the ref current without touching refs during render.
  useEffect(() => {
    kioskMirrorRef.current = isMirrored;
  }, [isMirrored]);
  useEffect(() => {
    if (!hasSupabaseEnv) return;
    let canvas: HTMLCanvasElement | null = null;

    const frameTick = () => {
      const channel = kioskChannelRef.current;
      if (!channel) return;
      const video = webcamRef.current?.video;
      if (!video || video.readyState < 2 || !video.videoWidth) return;

      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 480;
      }
      const context = canvas.getContext("2d");
      if (!context) return;

      // Cover-crop the video into the 4:3 preview, mirroring to match the
      // operator console when the mirror toggle is on.
      const videoRatio = video.videoWidth / video.videoHeight;
      const targetRatio = canvas.width / canvas.height;
      let sx = 0;
      let sy = 0;
      let sw = video.videoWidth;
      let sh = video.videoHeight;
      if (videoRatio > targetRatio) {
        sw = video.videoHeight * targetRatio;
        sx = (video.videoWidth - sw) / 2;
      } else {
        sh = video.videoWidth / targetRatio;
        sy = (video.videoHeight - sh) / 2;
      }

      context.save();
      if (kioskMirrorRef.current) {
        context.translate(canvas.width, 0);
        context.scale(-1, 1);
      }
      context.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      context.restore();

      const frame = canvas.toDataURL("image/jpeg", 0.7);
      if (frame.length > 300_000) return;
      void channel
        .send({
          type: "broadcast",
          event: KIOSK_FRAME_EVENT,
          payload: { frame, at: new Date().toISOString() }
        })
        .catch(() => {
          // ignore
        });
    };

    frameTickRef.current = frameTick;
    return () => {
      frameTickRef.current = null;
    };
  }, []);

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

  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedEventId) ?? null,
    [events, selectedEventId]
  );

  const compatibleEvents = useMemo(() => {
    if (!selectedContext) return [];
    return events
      .filter((event) => isEventCompatible(selectedContext, event.event_type))
      .slice()
      .sort((a, b) => {
        if (a.event_date === b.event_date) return a.title.localeCompare(b.title);
        if (a.event_date === null) return 1;
        if (b.event_date === null) return -1;
        return a.event_date.localeCompare(b.event_date);
      });
  }, [events, selectedContext]);

  const handleContextChange = (option: AttendanceType) => {
    setSelectedContext(option);
    setSelectedGroup(null);
    autoMarkCooldownRef.current.clear();
    stableMatchRef.current = { key: "", frames: 0 };

    if (selectedEventId) {
      const currentEvent = events.find((event) => event.id === selectedEventId);
      if (!currentEvent || !isEventCompatible(option, currentEvent.event_type)) {
        setSelectedEventId(null);
      }
    }
  };

  const handleSessionChange = (session: SundaySession) => {
    setSelectedGroup(session);
    autoMarkCooldownRef.current.clear();
    stableMatchRef.current = { key: "", frames: 0 };
  };

  const loadLogsForDate = useCallback(async (date: string) => {
    let attendanceRows: AttendanceLog[] = [];
    attendanceLoadedDateRef.current = null;

    const attendanceResult = await withSupabaseRetry(() =>
      supabase
        .from("attendance")
        .select("id, student_id, full_name, was_newcomer, attendance_context, attendance_group, service_type, event_id, attended_date, attended_at")
        .eq("attended_date", date)
    );

    if (attendanceResult.error) {
      if (isMissingServiceTypeColumnError(attendanceResult.error.message)) {
        const withoutServiceType = await supabase
          .from("attendance")
          .select("id, student_id, full_name, was_newcomer, attendance_context, attendance_group, event_id, attended_date, attended_at")
          .eq("attended_date", date);

        if (withoutServiceType.error) throw withoutServiceType.error;

        attendanceRows = ((withoutServiceType.data ?? []) as AttendanceLog[]).map((row) => ({
          ...row,
          service_type: normalizeServiceType(
            row.attendance_context,
            null,
            row.attendance_group
          )
        }));
      } else if (isMissingClassificationColumnError(attendanceResult.error.message)) {
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
          service_type: null,
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
        .map((row) => {
          const context = normalizeAttendanceType(row.attendance_context, row.attendance_group);
          const group = context ? attendanceGroupFor(context, row.service_type ?? row.attendance_group) : null;
          if (!context || !group) return null;
          return makeAttendanceKey(row.student_id, row.attended_date, context, group);
        })
        .filter((key): key is string => Boolean(key))
    );
    attendanceLoadedDateRef.current = date;
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

        if (adminState !== "allowed") return;

        await loadFaceApiModels();
        const settings = loadAppSettings();
        setNewcomerClearCount(settings.newcomerClearScanCount);

        const usersResult = await supabase
          .from("users")
          .select("id, student_id, full_name, age, gender, newcomer, is_active, descriptor, created_at");

        let usersData: UserFace[] = [];

        if (usersResult.error) {
          if (!isMissingActiveColumnError(usersResult.error.message)) throw usersResult.error;

          const usersFallback = await supabase
            .from("users")
            .select("id, student_id, full_name, age, gender, newcomer, descriptor, created_at");

          if (usersFallback.error) throw usersFallback.error;

          usersData = ((usersFallback.data ?? []) as UserFace[]).map((row) => ({
            ...row,
            is_active: null
          }));
        } else {
          usersData = (usersResult.data ?? []) as UserFace[];
        }

        const eventsResult = await supabase
          .from("events")
          .select("id, title, details, event_date, location, poster_url, event_type, created_at")
          .order("event_date", { ascending: true });

        if (!eventsResult.error) {
          setEvents((eventsResult.data ?? []) as EventItem[]);
        } else if (isMissingEventTypeColumnError(eventsResult.error.message)) {
          const eventsFallback = await supabase
            .from("events")
            .select("id, title, details, event_date, location, poster_url, created_at")
            .order("event_date", { ascending: true });

          if (eventsFallback.error) throw eventsFallback.error;

          setEvents(
            ((eventsFallback.data ?? []) as Array<Omit<EventItem, "event_type">>).map((row) => ({
              ...row,
              event_type: null
            }))
          );
        } else if (!isMissingEventsTableError(eventsResult.error.message)) {
          throw eventsResult.error;
        }

        await loadLogsForDate(getTodayIsoDate());

        if (mounted) {
          setUsers(usersData);
          setIsReady(true);
          setStatusType("info");
          setStatusMessage("Select attendance type, date, and an optional linked event before scanning.");
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
  }, [adminState, loadLogsForDate]);

  useEffect(() => {
    if (!isReady) return;

    const load = async () => {
      try {
        await loadLogsForDate(selectedDate);
      } catch (err: unknown) {
        console.error(err);
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        setStatusType("error");
        setStatusMessage(`Failed to load attendance for date: ${errorMessage}`);
      }
    };

    void load();
  }, [isReady, loadLogsForDate, selectedDate]);

  const markAttendance = useCallback(async (studentId: string, fullName: string) => {
    if (!selectedContext) {
      setStatusType("error");
      setStatusMessage("Select attendance type before scanning.");
      return;
    }

    const targetContext = selectedContext;
    const targetGroup = attendanceGroupFor(targetContext, selectedGroup);

    if (!targetGroup) {
      setStatusType("error");
      setStatusMessage("Select First Service or Second Service before scanning.");
      return;
    }

    const targetSession = targetContext === "Sunday Service" ? selectedGroup : null;
    const attendanceDate = selectedDate;
    const attendanceKey = makeAttendanceKey(studentId, attendanceDate, targetContext, targetGroup);
    const duplicateMessage =
      targetContext === "Sunday Service"
        ? SUNDAY_SERVICE_DUPLICATE_MESSAGE
        : ATTENDANCE_ERROR_MESSAGES.duplicate;

    let eventIdForScan: string | null = null;
    let eventTitleForScan: string | null = null;

    if (selectedEventId) {
      const currentEvent = events.find((event) => event.id === selectedEventId);

      if (!currentEvent) {
        setSelectedEventId(null);
        setStatusType("error");
        setStatusMessage(ATTENDANCE_ERROR_MESSAGES.eventMissing);
        return;
      }

      if (!isEventCompatible(targetContext, currentEvent.event_type)) {
        setSelectedEventId(null);
        setStatusType("error");
        setStatusMessage(ATTENDANCE_ERROR_MESSAGES.eventMismatch);
        return;
      }

      eventIdForScan = currentEvent.id;
      eventTitleForScan = currentEvent.title;
    }

    setIsSaving(true);

    try {
      const memberResult = await withSupabaseRetry(() =>
        supabase
          .from("users")
          .select("student_id")
          .eq("student_id", studentId)
          .maybeSingle()
      );

      if (memberResult.error) throw memberResult.error;

      if (!memberResult.data) {
        setStatusType("error");
        setStatusMessage(ATTENDANCE_ERROR_MESSAGES.unregistered);
        return;
      }

      if (attendanceMarkedRef.current.has(attendanceKey)) {
        setStatusType("info");
        setStatusMessage(duplicateMessage);
        setLatestMatch({
          name: fullName,
          studentId,
          context: targetContext,
          group: targetGroup,
          session: targetSession ?? "N/A",
          eventTitle: eventTitleForScan
        });
        return;
      }

      // Read the database rather than relying on local state so changes made on
      // other devices/tabs are honoured immediately.
      const existingResult = await withSupabaseRetry(() =>
        supabase
          .from("attendance")
          .select("id")
          .eq("student_id", studentId)
          .eq("attended_date", attendanceDate)
          .eq("attendance_context", targetContext)
          .limit(1)
      );

      if (existingResult.error) throw existingResult.error;

      if ((existingResult.data ?? []).length > 0) {
        attendanceMarkedRef.current.add(attendanceKey);
        setStatusType("info");
        setStatusMessage(duplicateMessage);
        setLatestMatch({
          name: fullName,
          studentId,
          context: targetContext,
          group: targetGroup,
          session: targetSession ?? "N/A",
          eventTitle: eventTitleForScan
        });
        return;
      }

      const attendancePayload = {
        student_id: studentId,
        full_name: fullName,
        was_newcomer: Boolean(users.find((user) => user.student_id === studentId)?.newcomer),
        attendance_context: targetContext,
        attendance_group: targetGroup,
        service_type: targetSession,
        event_id: eventIdForScan,
        attended_date: attendanceDate,
        attended_at: new Date().toISOString()
      };

      const { error: insertError } = await withSupabaseRetry(() =>
        supabase.from("attendance").insert(attendancePayload)
      );

      if (insertError) {
        const mapped = describeAttendanceDbError(
          `${insertError.message} ${insertError.details ?? ""} ${insertError.hint ?? ""} ${insertError.code ?? ""}`
        );

        if (mapped) {
          if (mapped.kind === "duplicate") attendanceMarkedRef.current.add(attendanceKey);
          setStatusType(mapped.kind === "duplicate" ? "info" : "error");
          setStatusMessage(mapped.kind === "duplicate" ? duplicateMessage : mapped.message);
          if (mapped.kind === "duplicate") {
            setLatestMatch({
              name: fullName,
              studentId,
              context: targetContext,
              group: targetGroup,
              session: targetSession ?? "N/A",
              eventTitle: eventTitleForScan
            });
          }
          return;
        }

        throw insertError;
      }

      attendanceMarkedRef.current.add(attendanceKey);
      setTodayLogs((prev) => [
        {
          id: crypto.randomUUID(),
          ...attendancePayload
        },
        ...prev
      ]);

      const matchedUser = users.find((user) => user.student_id === studentId);
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
      setStatusMessage("Attendance recorded successfully!");
      setLatestMatch({
        name: fullName,
        studentId,
        context: targetContext,
        group: targetGroup,
        session: targetSession ?? "N/A",
        eventTitle: eventTitleForScan
      });
      publishKioskScan(
        "recognized",
        fullName,
        targetContext === "Sunday Service" ? (targetGroup ?? targetContext) : targetContext
      );
    } catch (err: unknown) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      const mapped = describeAttendanceDbError(errorMessage);
      setStatusType(mapped?.kind === "duplicate" ? "info" : "error");
      setStatusMessage(mapped?.message ?? `Failed to save attendance: ${errorMessage}`);
      publishKioskScan(
        mapped?.kind === "duplicate" ? "duplicate" : "failed",
        fullName,
        targetContext === "Sunday Service" ? (targetGroup ?? targetContext) : targetContext
      );
    } finally {
      setIsSaving(false);
    }
  }, [events, newcomerClearCount, publishKioskScan, selectedContext, selectedDate, selectedEventId, selectedGroup, users]);

  useEffect(() => {
    if (!isReady) return;

    // Idle/blocked scanner status updates are dispatched from an async
    // continuation instead of synchronously inside the effect body, so the
    // status panel render is not cascaded directly off the effect run.
    const setStatusAsync = async (type: ScannerStatusType, message: string) => {
      setStatusType(type);
      setStatusMessage(message);
    };

    if (users.length === 0) {
      void setStatusAsync("error", "No registered users found. Register users first.");
      return;
    }

    livenessGateRef.current.reset();

    const groupForScan = selectedContext
      ? attendanceGroupFor(selectedContext, selectedGroup)
      : null;

    if (!selectedContext || !groupForScan) {
      void setStatusAsync(
        "info",
        selectedContext === "Sunday Service"
          ? "Select First Service or Second Service before scanning."
          : "Select an attendance type before scanning."
      );
      return;
    }

    const activeContext: AttendanceType = selectedContext;
    const activeGroup: string = groupForScan;

    if (knownDescriptors.length === 0) {
      void setStatusAsync("error", "No valid descriptors found. Re-register users.");
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

    let scanTickCounter = 0;
    const runScanTick = () => {
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
            setStatus("info", "Liveness check: blink or gently turn your head.");
            return;
          }

          let best: ((typeof knownDescriptors)[number] & { distance: number }) | null = null;
          let secondDistance = Number.POSITIVE_INFINITY;

          for (const entry of knownDescriptors) {
            const distance = faceapi.euclideanDistance(detection.descriptor, entry.descriptor);
            if (!best || distance < best.distance) {
              secondDistance = best?.distance ?? Number.POSITIVE_INFINITY;
              best = { ...entry, distance };
            } else if (distance < secondDistance) {
              secondDistance = distance;
            }
          }

          if (!best || best.distance > FACE_DISTANCE_THRESHOLD) {
            stableMatchRef.current = { key: "", frames: 0 };
            livenessGateRef.current.reset();
            setStatus("error", ATTENDANCE_ERROR_MESSAGES.unregistered);
            return;
          }

          if (secondDistance - best.distance < FACE_AMBIGUITY_GAP) {
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

          const scanKey = makeAttendanceKey(
            best.user.student_id,
            selectedDate,
            activeContext,
            activeGroup
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
    };

    // Driven by the throttling-immune tick worker; every second tick keeps
    // the original 500 ms detection cadence.
    scanTickRef.current = () => {
      scanTickCounter += 1;
      if (scanTickCounter % 2 === 0) return;
      runScanTick();
    };

    return () => {
      scanTickRef.current = null;
    };
  }, [isReady, knownDescriptors, markAttendance, selectedContext, selectedDate, selectedEventId, selectedGroup, users.length]);

  if (adminState === "checking") {
    return (
      <div className="space-y-6 reveal">
        <section>
          <h1 className="page-title font-[var(--font-heading)]">Attendance Scanning</h1>
        </section>
        <div className="card">
          <p className="font-[var(--font-heading)] text-lg text-[#22332d]">Checking scanner access...</p>
          <p className="mt-2 text-sm text-[#5d7269]">Verifying your administrator permissions.</p>
        </div>
      </div>
    );
  }

  if (adminState === "denied") {
    return (
      <div className="space-y-6 reveal">
        <section>
          <h1 className="page-title font-[var(--font-heading)]">Attendance Scanning</h1>
        </section>
        <div className="card">
          <p className="font-[var(--font-heading)] text-lg text-[#22332d]">Access denied</p>
          <p className="mt-2 text-sm text-[#5d7269]">
            Attendance scanning is restricted to administrator accounts. Please contact your system administrator if you
            believe you should have access.
          </p>
          <Link href="/" className="btn-ghost mt-4 inline-block text-xs">Return to Home</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 reveal">
      <section>
        <h1 className="page-title font-[var(--font-heading)]">Attendance Scanning</h1>
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

      {selectedContext && compatibleEvents.length === 0 ? (
        <div className="card status-info">
          No events are compatible with {selectedContext} yet. You can still record attendance without a linked event, or create one in{" "}
          <Link href="/events-manager" className="font-semibold underline">Event Manager</Link>.
        </div>
      ) : null}

      <section className="card scan-focus-panel space-y-4" data-tour="attendance-scanner">
        <p className="rounded-xl border border-[#98b6aa] bg-[#e7f1ed] px-4 py-3 text-base font-semibold text-[#25493e] md:text-lg">
          Select an attendance type, then scan. A linked event is optional.
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
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="field-label mb-0">Attendance Type</p>
          <span className="rounded-full border border-[#9bb6ad] bg-[#edf5f2] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#2f5145]">
            Required Before Scan
          </span>
        </div>

        <div className="-mt-2 flex flex-wrap gap-2">
          {ATTENDANCE_TYPES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => handleContextChange(option)}
              className={selectedContext === option ? "btn-primary" : "btn-ghost"}
            >
              {option}
            </button>
          ))}
        </div>

        {selectedContext === "Sunday Service" ? (
          <div>
            <p className="field-label">Sunday Service Session</p>
            <div className="flex flex-wrap gap-2">
              {SUNDAY_SESSIONS.map((session) => (
                <button
                  key={session}
                  type="button"
                  onClick={() => handleSessionChange(session)}
                  className={selectedGroup === session ? "btn-primary" : "btn-ghost"}
                >
                  {session}
                </button>
              ))}
            </div>
            {!selectedGroup ? (
              <p className="mt-2 text-xs font-semibold text-[#35584c]">
                Select First Service or Second Service to activate the scanner.
              </p>
            ) : null}
          </div>
        ) : null}

        <div>
          <label className="field-label" htmlFor="linked-event">
            Linked Event (Optional)
          </label>
          <select
            id="linked-event"
            className="field-input max-w-xl"
            value={selectedEventId ?? ""}
            onChange={(event) => setSelectedEventId(event.target.value || null)}
          >
            <option value="">No linked event</option>
            {compatibleEvents.map((event) => (
              <option key={event.id} value={event.id}>
                {event.title}
                {event.event_date ? ` — ${event.event_date}` : ""}
                {event.event_type ? ` (${event.event_type})` : ""}
              </option>
            ))}
          </select>
          {selectedContext ? (
            <p className="mt-2 text-xs text-[#5f756c]">
              Showing {compatibleEventTypes(selectedContext).join(" / ")} events. You can scan without selecting one.
            </p>
          ) : null}
          {selectedContext && compatibleEvents.length === 0 ? (
            <p className="mt-1 text-xs font-semibold text-[#35584c]">
              No compatible events yet — attendance can still be recorded.
            </p>
          ) : null}
        </div>

      </section>

      <section className="analytics-strip">
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Mode</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">Fast Scan</p>
        </article>
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">
            {selectedContext === "Sunday Service" ? "Service Session" : "Attendance Type"}
          </p>
          <p className="mt-2 font-[var(--font-heading)] text-xl text-[#22322d]">
            {selectedContext === "Sunday Service" ? (selectedGroup ?? "None") : (selectedContext ?? "None")}
          </p>
        </article>
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Linked Event</p>
          <p className="mt-2 font-[var(--font-heading)] text-xl text-[#22322d]">
            {selectedEvent?.title ?? "None (optional)"}
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
              onClick={() => setIsMirrored((prev) => !prev)}
            >
              Mirror Camera
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
              facingMode: "user",
              width: { ideal: 1280 },
              height: { ideal: 720 }
            }}
            className={`h-auto w-full rounded-xl border border-[#b9c8c2] shadow-[0_12px_26px_rgba(56,91,79,0.16)] ${
              isMirrored ? "scale-x-[-1]" : ""
            }`}
          />
          <div className="chart-frame h-24" />
        </div>

        <aside className="space-y-4">
          <div className="card space-y-3">
            <h2 className="font-[var(--font-heading)] text-lg text-[#23332d]">Scanner Status</h2>
            {isSaving ? (
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#35584c]">Processing attendance...</p>
            ) : null}
            <div className={statusClass}>{statusMessage}</div>
          </div>

          <div className="card space-y-2">
            <h2 className="font-[var(--font-heading)] text-lg text-[#23332d]">Latest Match</h2>
            {latestMatch ? (
              <div className="rounded-xl border border-[#a7c3b8] bg-[#e8f3ef] p-3 text-sm text-[#2f5b4c]">
                <p className="font-semibold">{latestMatch.name}</p>
                <p>ID: {latestMatch.studentId}</p>
                <p>
                  {latestMatch.context}
                  {latestMatch.session !== "N/A" ? ` • ${latestMatch.session}` : ""}
                </p>
                <p>Event: {latestMatch.eventTitle ?? "None (optional)"}</p>
              </div>
            ) : (
              <p className="text-sm text-[#4e655d]">No successful match yet.</p>
            )}
          </div>

          <div className="card space-y-2">
            <h2 className="font-[var(--font-heading)] text-lg text-[#23332d]">Kiosk Display</h2>
            <p className="text-xs text-[#5e766c]">
              Streams the live camera preview and scanner status to the public display, plus scan confirmations —
              first names only, never IDs or records.
            </p>
            <button
              type="button"
              className="btn-primary w-full text-xs"
              onClick={() =>
                window.open("/attendance/kiosk", "mypresence-kiosk", "popup=true,width=1280,height=800")
              }
            >
              Open Kiosk Display
            </button>
            <p className="text-[11px] text-[#71847c]">
              On the kiosk screen, press Go Fullscreen and keep the display open. Exit anytime via Exit kiosk.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
