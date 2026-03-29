"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Webcam from "react-webcam";
import * as faceapi from "face-api.js";
import { getFaceDetectorOptions, loadFaceApiModels } from "@/lib/faceApi";
import { hasSupabaseEnv, supabase, supabaseEnvIssue } from "@/lib/supabase";
import { AttendanceLog, UserFace } from "@/types";
import { loadAppSettings } from "@/lib/app-settings";
import SimpleBarChart from "@/components/simple-bar-chart";
import { GROUP_COLORS } from "@/lib/analytics-colors";

type ScannerStatusType = "info" | "success" | "error";
type AttendanceContext = "Sunday Service" | "Events";
type AttendanceGroup = "First Service" | "Second Service" | "Rooftop" | "Male" | "Female";

const contextOptions: AttendanceContext[] = ["Sunday Service", "Events"];

const groupOptions: Record<AttendanceContext, AttendanceGroup[]> = {
  "Sunday Service": ["First Service", "Second Service"],
  Events: ["Rooftop", "Male", "Female"]
};

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function isMissingClassificationColumnError(message: string) {
  return /column\s+attendance\.(was_newcomer|attendance_context|attendance_group)\s+does not exist/i.test(message);
}

function getGroupKey(log: AttendanceLog): AttendanceGroup | null {
  if (log.attendance_context === "Sunday Service") {
    if (log.attendance_group === "First Service" || log.attendance_group === "Second Service") {
      return log.attendance_group;
    }
    return null;
  }

  if (log.attendance_context === "Events") {
    if (log.attendance_group === "Rooftop" || log.attendance_group === "Male" || log.attendance_group === "Female") {
      return log.attendance_group;
    }
    return null;
  }

  return null;
}

function makeAttendanceKey(studentId: string, date: string, context: AttendanceContext, group: AttendanceGroup) {
  return `${studentId}|${date}|${context}|${group}`;
}

export default function AttendancePage() {
  const webcamRef = useRef<Webcam | null>(null);
  const attendanceMarkedRef = useRef<Set<string>>(new Set());
  const scanInProgressRef = useRef(false);

  const [statusType, setStatusType] = useState<ScannerStatusType>("info");
  const [statusMessage, setStatusMessage] = useState("Loading models and known face descriptors...");
  const [isReady, setIsReady] = useState(false);
  const [users, setUsers] = useState<UserFace[]>([]);
  const [todayLogs, setTodayLogs] = useState<AttendanceLog[]>([]);
  const [newcomerClearCount, setNewcomerClearCount] = useState<1 | 2>(2);
  const [selectedContext, setSelectedContext] = useState<AttendanceContext | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<AttendanceGroup | null>(null);
  const [latestMatch, setLatestMatch] = useState<{ name: string; studentId: string; context: AttendanceContext; group: AttendanceGroup } | null>(null);

  const statusClass = useMemo(() => {
    if (statusType === "success") return "status-success";
    if (statusType === "error") return "status-error";
    return "status-info";
  }, [statusType]);

  const buildMatcher = useCallback((knownUsers: UserFace[]) => {
    const labeledDescriptors = knownUsers
      .filter((u) => Array.isArray(u.descriptor) && u.descriptor.length > 0)
      .map(
        (u) =>
          new faceapi.LabeledFaceDescriptors(
            `${u.student_id}::${u.full_name}`,
            [new Float32Array(u.descriptor)]
          )
      );

    if (!labeledDescriptors.length) {
      return null;
    }

    return new faceapi.FaceMatcher(labeledDescriptors, 0.5);
  }, []);

  const analytics = useMemo(() => {
    const base = {
      "First Service": 0,
      "Second Service": 0,
      Rooftop: 0,
      Male: 0,
      Female: 0
    } as Record<AttendanceGroup, number>;

    const newcomerBase = {
      "First Service": 0,
      "Second Service": 0,
      Rooftop: 0,
      Male: 0,
      Female: 0
    } as Record<AttendanceGroup, number>;

    for (const log of todayLogs) {
      const key = getGroupKey(log);
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
  }, [todayLogs]);

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

        const { data, error } = await supabase
          .from("users")
          .select("id, student_id, full_name, age, gender, newcomer, descriptor, created_at");

        if (error) throw error;

        const knownUsers = (data ?? []) as UserFace[];

        const today = getTodayIsoDate();
        let attendanceRows: AttendanceLog[] = [];

        const attendanceResult = await supabase
          .from("attendance")
          .select("id, student_id, full_name, was_newcomer, attendance_context, attendance_group, attended_date, attended_at")
          .eq("attended_date", today);

        if (attendanceResult.error) {
          if (isMissingClassificationColumnError(attendanceResult.error.message)) {
            const fallback = await supabase
              .from("attendance")
              .select("id, student_id, full_name, was_newcomer, attended_date, attended_at")
              .eq("attended_date", today);

            if (fallback.error) throw fallback.error;

            attendanceRows = ((fallback.data ?? []) as Array<Omit<AttendanceLog, "was_newcomer" | "attendance_context" | "attendance_group">>).map((row) => ({
              ...row,
              was_newcomer: false,
              attendance_context: null,
              attendance_group: null
            }));

            if (mounted) {
              setStatusType("info");
              setStatusMessage("Attendance categories are not in DB yet. Run supabase/schema.sql to enable service/event analytics.");
            }
          } else {
            throw attendanceResult.error;
          }
        } else {
          attendanceRows = (attendanceResult.data ?? []) as AttendanceLog[];
        }

        if (mounted) {
          setUsers(knownUsers);
          attendanceMarkedRef.current = new Set(
            attendanceRows
              .filter((row) => row.attendance_context && row.attendance_group)
              .map((row) =>
                makeAttendanceKey(
                  row.student_id,
                  row.attended_date,
                  row.attendance_context as AttendanceContext,
                  row.attendance_group as AttendanceGroup
                )
              )
          );
          setTodayLogs(attendanceRows);
          setIsReady(true);
          if (!selectedContext || !selectedGroup) {
            setStatusType("info");
            setStatusMessage("Select attendance type and group before scanning.");
          }
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
  }, []);

  const markAttendance = useCallback(async (studentId: string, fullName: string) => {
    if (!selectedContext || !selectedGroup) {
      setStatusType("error");
      setStatusMessage("Select attendance type and group before scanning.");
      return;
    }

    const today = getTodayIsoDate();
    const matchedUser = users.find((user) => user.student_id === studentId);
    const wasNewcomer = Boolean(matchedUser?.newcomer);
    const attendanceKey = makeAttendanceKey(studentId, today, selectedContext, selectedGroup);

    if (attendanceMarkedRef.current.has(attendanceKey)) {
      setStatusType("info");
      setStatusMessage(`${fullName} is already marked for ${selectedGroup} today.`);
      setLatestMatch({ name: fullName, studentId, context: selectedContext, group: selectedGroup });
      return;
    }

    const { error } = await supabase.from("attendance").insert({
      student_id: studentId,
      full_name: fullName,
      was_newcomer: wasNewcomer,
      attendance_context: selectedContext,
      attendance_group: selectedGroup,
      attended_date: today,
      attended_at: new Date().toISOString()
    });

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
        attended_date: today,
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
  }, [newcomerClearCount, selectedContext, selectedGroup, users]);

  useEffect(() => {
    if (!isReady || users.length === 0) {
      if (isReady && users.length === 0) {
        setStatusType("error");
        setStatusMessage("No registered users found. Register users first.");
      }
      return;
    }

    if (!selectedContext || !selectedGroup) {
      setStatusType("info");
      setStatusMessage("Select attendance type and group before scanning.");
      return;
    }

    const matcher = buildMatcher(users);
    if (!matcher) {
      setStatusType("error");
      setStatusMessage("No valid descriptors found. Re-register users.");
      return;
    }

    const interval = setInterval(() => {
      if (scanInProgressRef.current) return;

      const video = webcamRef.current?.video as HTMLVideoElement | undefined;
      if (!video || video.readyState < 2) return;

      scanInProgressRef.current = true;

      faceapi
        .detectAllFaces(video, getFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptors()
        .then(async (detections: Array<{ descriptor: Float32Array }>) => {
          if (detections.length === 0) {
            setStatusType("info");
            setStatusMessage("No face detected.");
            return;
          }

          if (detections.length > 1) {
            setStatusType("error");
            setStatusMessage("Multiple faces detected. Please keep one face visible.");
            return;
          }

          const bestMatch = matcher.findBestMatch(detections[0].descriptor);

          if (bestMatch.label === "unknown" || bestMatch.distance > 0.5) {
            setStatusType("error");
            setStatusMessage("Low confidence match. Try moving closer to camera.");
            return;
          }

          const [studentId, fullName] = bestMatch.label.split("::");
          await markAttendance(studentId, fullName);
        })
        .catch((err: unknown) => {
          console.error(err);
          setStatusType("error");
          setStatusMessage("Error during face scan.");
        })
        .finally(() => {
          scanInProgressRef.current = false;
        });
    }, 1200);

    return () => {
      clearInterval(interval);
    };
  }, [buildMatcher, isReady, markAttendance, selectedContext, selectedGroup, users]);

  return (
    <div className="space-y-6 reveal">
      <section>
        <h1 className="page-title font-[var(--font-heading)]">Attendance Scanning</h1>
        <p className="page-subtitle">Select the active service/event group, then scan faces in real time.</p>
      </section>

      <section className="card scan-focus-panel space-y-4">
        <p className="rounded-xl border border-[#98b6aa] bg-[#e7f1ed] px-4 py-3 text-base font-semibold text-[#25493e] md:text-lg">
          Select attendance type and group before scanning.
        </p>

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
      </section>

      <section className="analytics-strip">
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Mode</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl font-semibold text-[#22322d]">Fast Scan</p>
        </article>
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Selected Group</p>
          <p className="mt-2 font-[var(--font-heading)] text-xl font-semibold text-[#22322d]">{selectedGroup ?? "None"}</p>
        </article>
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Scans Today</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl font-semibold text-[#22322d]">{analytics.scansToday}</p>
        </article>
      </section>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="card bg-[#f8fbfa]">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-[#5a776b]">Live Attendance Feed</p>
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
              width: 960,
              height: 720
            }}
            className="h-auto w-full rounded-xl border border-[#b9c8c2] shadow-[0_12px_26px_rgba(56,91,79,0.16)]"
          />
          <div className="chart-frame h-24" />
        </div>

        <aside className="space-y-4">
          <div className="card space-y-3">
            <h2 className="font-[var(--font-heading)] text-lg font-semibold text-[#23332d]">Scanner Status</h2>
            <div className={statusClass}>{statusMessage}</div>
            <p className="text-xs text-[#5f756c]">Distance threshold: 0.5</p>
          </div>

          <div className="card space-y-2">
            <h2 className="font-[var(--font-heading)] text-lg font-semibold text-[#23332d]">Latest Match</h2>
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
          title="Attendance by Group (Today)"
          items={[
            { label: "1st Service", value: analytics.byGroup["First Service"], color: GROUP_COLORS.firstService },
            { label: "2nd Service", value: analytics.byGroup["Second Service"], color: GROUP_COLORS.secondService },
            { label: "Rooftop", value: analytics.byGroup.Rooftop, color: GROUP_COLORS.rooftop },
            { label: "Male", value: analytics.byGroup.Male, color: GROUP_COLORS.male },
            { label: "Female", value: analytics.byGroup.Female, color: GROUP_COLORS.female }
          ]}
        />
        <SimpleBarChart
          title="Newcomer Attendance by Group"
          items={[
            { label: "1st Service", value: analytics.newcomerByGroup["First Service"], color: GROUP_COLORS.firstService },
            { label: "2nd Service", value: analytics.newcomerByGroup["Second Service"], color: GROUP_COLORS.secondService },
            { label: "Rooftop", value: analytics.newcomerByGroup.Rooftop, color: GROUP_COLORS.rooftop },
            { label: "Male", value: analytics.newcomerByGroup.Male, color: GROUP_COLORS.male },
            { label: "Female", value: analytics.newcomerByGroup.Female, color: GROUP_COLORS.female }
          ]}
        />
      </div>
    </div>
  );
}
