"use client";

import { ChangeEvent, FormEvent, useCallback, useMemo, useRef, useState } from "react";
import Webcam from "react-webcam";
import * as faceapi from "face-api.js";
import { loadFaceApiModels, getFaceDetectorOptions } from "@/lib/faceApi";
import { hasSupabaseEnv, supabase, supabaseEnvIssue } from "@/lib/supabase";
import { extractLivenessMetrics } from "@/lib/liveness";

type RegisterStatusType = "idle" | "info" | "success" | "error";
type ChallengeType = "blink" | "turn";

type ChallengeDetection = {
  descriptor: Float32Array;
  landmarks: Parameters<typeof extractLivenessMetrics>[0];
  detection: { box: { x: number; width: number } };
};

function toErrorMessage(err: unknown) {
  if (err instanceof Error) return err.message;

  if (typeof err === "object" && err !== null) {
    const data = err as Record<string, unknown>;
    const parts = [data.message, data.error_description, data.details, data.hint, data.code]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim());

    if (parts.length > 0) {
      return parts.join(" | ");
    }
  }

  return String(err);
}

export default function RegisterPage() {
  const webcamRef = useRef<Webcam | null>(null);
  const [fullName, setFullName] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState<"Male" | "Female">("Male");
  const [newcomer, setNewcomer] = useState(true);
  const [cameraFacingMode, setCameraFacingMode] = useState<"user" | "environment">("user");
  const [loading, setLoading] = useState(false);
  const [statusType, setStatusType] = useState<RegisterStatusType>("idle");
  const [statusMessage, setStatusMessage] = useState("Fill in details and capture a single clear face.");

  const statusClass = useMemo(() => {
    if (statusType === "success") return "status-success";
    if (statusType === "error") return "status-error";
    return "status-info";
  }, [statusType]);

  const handleUserMediaError = useCallback(() => {
    setStatusType("error");
    setStatusMessage("Camera permission denied or unavailable.");
  }, []);

  const onFullNameChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setFullName(event.target.value);
  }, []);

  const onAgeChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setAge(event.target.value);
  }, []);

  const runAntiPhotoChallenge = useCallback(async (video: HTMLVideoElement) => {
    const runChallengeOnce = async (challenge: ChallengeType) => {
      const challengeText = challenge === "blink" ? "Blink once" : "Turn your head slightly left or right";
      const timeoutMs = 8500;
      const startedAt = Date.now();

      let eyeWasOpen = false;
      let blinkPassed = false;
      let baseNoseRatio: number | null = null;
      let turnPassed = false;
      let latestDetection: ChallengeDetection | null = null;

      setStatusType("info");
      setStatusMessage(`Anti-photo check: ${challengeText}`);

      // Give the user a brief moment to read the prompt before evaluation starts.
      await new Promise((resolve) => setTimeout(resolve, 700));

      while (Date.now() - startedAt < timeoutMs) {
        const detection = await faceapi
          .detectSingleFace(video, getFaceDetectorOptions())
          .withFaceLandmarks()
          .withFaceDescriptor();

        if (!detection) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          continue;
        }

        latestDetection = detection as unknown as ChallengeDetection;
        const metrics = extractLivenessMetrics(detection.landmarks, detection.detection.box);
        if (!metrics) {
          await new Promise((resolve) => setTimeout(resolve, 180));
          continue;
        }

        if (challenge === "blink") {
          if (metrics.ear > 0.235) eyeWasOpen = true;
          if (eyeWasOpen && metrics.ear < 0.19) {
            blinkPassed = true;
            break;
          }
        }

        if (challenge === "turn") {
          if (baseNoseRatio === null) {
            baseNoseRatio = metrics.noseRatio;
          } else if (Math.abs(metrics.noseRatio - baseNoseRatio) >= 0.025) {
            turnPassed = true;
            break;
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 180));
      }

      const passed = challenge === "blink" ? blinkPassed : turnPassed;
      return { passed, detection: latestDetection };
    };

    const firstChallenge: ChallengeType = Math.random() > 0.5 ? "blink" : "turn";
    const secondChallenge: ChallengeType = firstChallenge === "blink" ? "turn" : "blink";

    const firstAttempt = await runChallengeOnce(firstChallenge);
    if (firstAttempt.passed) {
      return firstAttempt;
    }

    setStatusType("info");
    setStatusMessage("Quick retry: follow one more prompt.");
    const secondAttempt = await runChallengeOnce(secondChallenge);
    if (secondAttempt.passed) {
      return secondAttempt;
    }

    return {
      passed: false,
      detection: secondAttempt.detection ?? firstAttempt.detection
    };
  }, []);

  const generateMemberId = useCallback(() => {
    const token = Math.random().toString(36).slice(2, 7).toUpperCase();
    return `MP-${Date.now().toString().slice(-6)}-${token}`;
  }, []);

  const registerFace = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!hasSupabaseEnv) {
        setStatusType("error");
        setStatusMessage(supabaseEnvIssue ?? "Missing Supabase env values. Update .env.local and restart dev server.");
        return;
      }

      if (!fullName.trim()) {
        setStatusType("error");
        setStatusMessage("Name is required.");
        return;
      }

      const parsedAge = Number(age);
      if (!Number.isFinite(parsedAge) || parsedAge < 1 || parsedAge > 120) {
        setStatusType("error");
        setStatusMessage("Please enter a valid age (1-120).");
        return;
      }

      const video = webcamRef.current?.video as HTMLVideoElement | undefined;
      if (!video || video.readyState < 2) {
        setStatusType("error");
        setStatusMessage("Unable to access live camera feed. Please check your webcam.");
        return;
      }

      setLoading(true);
      setStatusType("info");
      setStatusMessage("Loading models and preparing anti-photo check...");

      try {
        await loadFaceApiModels();

        const challengeResult = await runAntiPhotoChallenge(video);

        if (!challengeResult.detection) {
          setStatusType("error");
          setStatusMessage("No face detected. Move closer and try again.");
          return;
        }

        if (!challengeResult.passed) {
          setStatusType("error");
          setStatusMessage("Anti-photo check failed. Please try again with a live face.");
          return;
        }

        const liveDetection = challengeResult.detection;

        if (!liveDetection) {
          setStatusType("error");
          setStatusMessage("No face detected. Move closer and try again.");
          return;
        }

        const descriptorArray = Array.from(liveDetection.descriptor);
        const memberId = generateMemberId();

        const { error } = await supabase.from("users").upsert(
          {
            student_id: memberId,
            full_name: fullName.trim(),
            age: parsedAge,
            gender,
            newcomer,
            descriptor: descriptorArray
          },
          { onConflict: "student_id" }
        );

        if (error) {
          throw error;
        }

        setStatusType("success");
        setStatusMessage(`Registered ${fullName.trim()} successfully. Generated ID: ${memberId}`);
        setFullName("");
        setAge("");
        setGender("Male");
        setNewcomer(true);
      } catch (err: unknown) {
        console.error(err);
        setStatusType("error");
        const errorMessage = toErrorMessage(err);
        setStatusMessage(`Failed to register user: ${errorMessage}`);
      } finally {
        setLoading(false);
      }
    },
    [age, fullName, gender, generateMemberId, newcomer, runAntiPhotoChallenge]
  );

  return (
    <div className="space-y-6 reveal">
      <section>
        <h1 className="page-title font-[var(--font-heading)]">User Registration</h1>
        <p className="page-subtitle">Capture a face descriptor and store it with name and ID.</p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card space-y-5">
          <form className="space-y-4" onSubmit={registerFace}>
            <div>
              <label className="field-label">Name</label>
              <input
                value={fullName}
                onChange={onFullNameChange}
                type="text"
                required
                className="field-input"
                placeholder="e.g. Alex Kim"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="field-label">Age</label>
                <input
                  value={age}
                  onChange={onAgeChange}
                  type="number"
                  required
                  min={1}
                  max={120}
                  className="field-input"
                  placeholder="e.g. 21"
                />
              </div>
              <div>
                <label className="field-label">Gender</label>
                <select value={gender} onChange={(event) => setGender(event.target.value as "Male" | "Female")} className="field-input">
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </div>
            </div>
            <div className="rounded-xl border border-[#b8c9c2] bg-white/70 p-3">
              <label className="flex items-center gap-2 text-sm font-semibold text-[#35564a]">
                <input
                  type="checkbox"
                  checked={newcomer}
                  onChange={(event) => setNewcomer(event.target.checked)}
                  className="h-4 w-4 accent-[#385b4f]"
                />
                Mark as newcomer
              </label>
              <p className="mt-1 text-xs text-[#60786f]">Newcomer tag auto-clears after configured attendance scans.</p>
            </div>
            <div className="rounded-xl border border-dashed border-[#a9bcb4] bg-[#f5faf8] p-3 text-xs text-[#5f756c]">
              Member ID will be generated automatically on save.
            </div>
            <div>
              <label className="field-label">Live Capture Requirement</label>
              <input
                type="text"
                disabled
                value="Single clear face in front of camera"
                className="field-input bg-[#eef4f1]"
              />
            </div>
            <button
              disabled={loading}
              type="submit"
              className="btn-primary"
            >
              {loading ? "Processing..." : "Capture and Register"}
            </button>
          </form>
          <div className={statusClass}>{statusMessage}</div>
        </div>

        <div className="card bg-[#f8fbfa]">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#5a776b]">Live Camera</p>
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
            onUserMediaError={handleUserMediaError}
            videoConstraints={{
              facingMode: cameraFacingMode,
              width: 640,
              height: 480
            }}
            className="h-auto w-full rounded-xl border border-[#b9c8c2] shadow-[0_10px_24px_rgba(56,91,79,0.16)]"
          />
          <div className="analytics-panel mt-4">
            <h3 className="font-[var(--font-heading)] text-lg text-[#22332d]">Capture Guide</h3>
            <p className="mt-2 text-sm text-[#5a7268]">Center your face, keep lighting clear, and follow the anti-photo prompt (blink or slight head turn).</p>
            <div className="chart-frame h-24" />
          </div>
        </div>
      </div>
    </div>
  );
}
