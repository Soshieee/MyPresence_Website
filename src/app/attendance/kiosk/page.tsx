"use client";

// P5 — Public-facing attendance kiosk display.
// Open this page on a second display, monitor, or the venue TV. It listens to
// the Supabase Realtime broadcast channel and shows ONLY public information:
// the live camera preview streamed from the operator console, sanitized
// scanner status, and scan confirmations with the member's first name.
// No navigation, no member data, no administrative information, no database
// access, and no camera of its own.

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { hasSupabaseEnv, supabase, supabaseEnvIssue } from "@/lib/supabase";
import {
  KIOSK_BROADCAST_EVENT,
  KIOSK_CHANNEL,
  KIOSK_FRAME_EVENT,
  KIOSK_RESET_MS,
  KIOSK_STATUS_EVENT,
  type KioskScanOutcome,
  type KioskScanPayload,
  type KioskStatusKind
} from "@/lib/kiosk";

type KioskState = {
  outcome: KioskScanOutcome | null;
  firstName: string | null;
  context: string | null;
};

type KioskStatusLine = { kind: KioskStatusKind; message: string } | null;

type CameraState = "requesting" | "native" | "stream" | "unavailable";

function isKioskPayload(value: unknown): value is KioskScanPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<KioskScanPayload>;
  return (
    payload.outcome === "recognized" ||
    payload.outcome === "duplicate" ||
    payload.outcome === "failed"
  );
}

const STATUS_STYLES: Record<KioskStatusKind, string> = {
  info: "border-white/25 bg-white/10 text-[#dce9e4]",
  success: "border-[#7ee2b8]/60 bg-[#7ee2b8]/15 text-[#7ee2b8]",
  error: "border-[#f0a028]/60 bg-[#f0a028]/15 text-[#ffd9a0]"
};

export default function KioskDisplayPage() {
  const router = useRouter();
  const [state, setState] = useState<KioskState>({ outcome: null, firstName: null, context: null });
  const [connected, setConnected] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [frame, setFrame] = useState<string | null>(null);
  const [statusLine, setStatusLine] = useState<KioskStatusLine>(null);
  const [cameraState, setCameraState] = useState<CameraState>("requesting");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const resetTimerRef = useRef<number | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);

  // When the kiosk runs on the same machine as the scanner, it opens its own
  // native camera stream (crisp, full frame rate, purely local — the video is
  // only shown, never analyzed or transmitted). On a remote display without a
  // usable camera, it falls back to the preview frames streamed by the
  // operator console.
  useEffect(() => {
    let cancelled = false;

    const openNativeCamera = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setCameraState("unavailable");
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        cameraStreamRef.current = stream;
        setCameraState("native");
      } catch {
        if (!cancelled) setCameraState("unavailable");
      }
    };

    void openNativeCamera();
    return () => {
      cancelled = true;
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    };
  }, []);

  // Attach the stream once the <video> element mounts (it renders only after
  // the camera state flips to "native").
  useEffect(() => {
    if (cameraState !== "native") return;
    const video = videoRef.current;
    if (video && cameraStreamRef.current && video.srcObject !== cameraStreamRef.current) {
      video.srcObject = cameraStreamRef.current;
      void video.play().catch(() => undefined);
    }
  }, [cameraState]);

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  const scheduleReset = useCallback(() => {
    clearResetTimer();
    resetTimerRef.current = window.setTimeout(() => {
      setState({ outcome: null, firstName: null, context: null });
    }, KIOSK_RESET_MS);
  }, [clearResetTimer]);

  // Broadcast subscription — the only external system this page touches.
  useEffect(() => {
    if (!hasSupabaseEnv) return;

    const channel = supabase.channel(KIOSK_CHANNEL);
    channel
      .on("broadcast", { event: KIOSK_BROADCAST_EVENT }, (message) => {
        const payload: unknown = message.payload;
        if (!isKioskPayload(payload)) return;
        clearResetTimer();
        setState({
          outcome: payload.outcome,
          firstName: (payload.firstName ?? "").trim().slice(0, 40) || null,
          context: payload.context ? payload.context.slice(0, 60) : null
        });
        if (payload.outcome !== "failed") scheduleReset();
      })
      .on("broadcast", { event: KIOSK_STATUS_EVENT }, (message) => {
        const payload = message.payload as { kind?: unknown; message?: unknown } | null;
        const kind: KioskStatusKind =
          payload?.kind === "success" || payload?.kind === "error" ? payload.kind : "info";
        const text = typeof payload?.message === "string" ? payload.message.slice(0, 140) : "";
        if (!text) return;
        setStatusLine({ kind, message: text });
      })
      .on("broadcast", { event: KIOSK_FRAME_EVENT }, (message) => {
        const payload = message.payload as { frame?: unknown } | null;
        const data = typeof payload?.frame === "string" ? payload.frame : "";
        if (data.startsWith("data:image/jpeg;base64,")) setFrame(data);
      })
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
      });

    return () => {
      void supabase.removeChannel(channel);
      clearResetTimer();
    };
  }, [clearResetTimer, scheduleReset]);

  // Keep the screen on while the kiosk is open.
  useEffect(() => {
    let cancelled = false;

    const requestWakeLock = async () => {
      try {
        const wakeLock = (
          navigator as unknown as {
            wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
          }
        ).wakeLock;
        if (!wakeLock) return;
        const lock = await wakeLock.request("screen");
        if (cancelled) {
          void lock.release();
          return;
        }
        wakeLockRef.current = lock;
        setWakeLockActive(true);
      } catch {
        setWakeLockActive(false);
      }
    };

    const releaseWakeLock = async () => {
      try {
        await wakeLockRef.current?.release();
      } catch {
        // ignore
      }
      wakeLockRef.current = null;
      setWakeLockActive(false);
    };

    void requestWakeLock();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void requestWakeLock();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void releaseWakeLock();
    };
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Fullscreen may be blocked (e.g., iframe); the display still works.
    }
  };

  const outcome = state.outcome;
  const idle = outcome === null;

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-[#1e2f29] via-[#2f4e44] to-[#385b4f] px-8 py-10 text-white">
      <div className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-[#6c8e82]/25 blur-3xl" />
      <div className="absolute -bottom-32 -right-20 h-[28rem] w-[28rem] rounded-full bg-[#16241f]/60 blur-3xl" />
      <div
        className="absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "30px 30px"
        }}
      />

      <div className="relative flex w-full max-w-4xl flex-col items-center text-center">
        <div className="flex items-center gap-4">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/20 bg-white/10 p-2 shadow-[0_14px_36px_rgba(0,0,0,0.3)] backdrop-blur">
            <Image
              src="/logo.png"
              alt="MyPresence logo"
              width={56}
              height={56}
              className="h-12 w-12 object-contain brightness-0 invert"
              priority
            />
          </span>
          <span className="text-sm font-semibold uppercase tracking-[0.3em] text-[#bcd2c9]">HPCI Thrive</span>
        </div>

        <div className="relative mt-6 w-full reveal" key={`${outcome ?? "idle"}-${state.firstName ?? ""}`}>
          {idle ? (
            <h1 className="font-[var(--font-heading)] text-4xl leading-tight md:text-6xl">
              Welcome to HPCI Thrive!
            </h1>
          ) : null}

          {outcome === "recognized" ? (
            <div className="flex flex-col items-center">
              <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[#7ee2b8]/20 ring-4 ring-[#7ee2b8]">
                <svg viewBox="0 0 24 24" className="h-10 w-10 text-[#7ee2b8]" fill="none" stroke="currentColor" strokeWidth="3">
                  <path d="m5 13 4 4L19 7" />
                </svg>
              </span>
              <h1 className="mt-4 font-[var(--font-heading)] text-4xl leading-tight md:text-6xl">
                Attendance Recorded!
              </h1>
              {state.firstName ? (
                <p className="mt-3 text-2xl text-[#dce9e4] md:text-3xl">
                  Welcome, <span className="font-semibold text-white">{state.firstName}</span>!
                </p>
              ) : null}
              <p className="mt-2 text-xl text-[#bcd2c9]">
                Thank you for joining us today{state.context ? ` — ${state.context}` : ""}.
              </p>
            </div>
          ) : null}

          {outcome === "duplicate" ? (
            <div className="flex flex-col items-center">
              <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[#f0a028]/20 ring-4 ring-[#f0a028]">
                <svg viewBox="0 0 24 24" className="h-10 w-10 text-[#f0a028]" fill="none" stroke="currentColor" strokeWidth="3">
                  <path d="M12 8v5" />
                  <path d="M12 16.5h.01" />
                  <circle cx="12" cy="12" r="9" />
                </svg>
              </span>
              <h1 className="mt-4 font-[var(--font-heading)] text-4xl leading-tight md:text-5xl">
                Already checked in!
              </h1>
              <p className="mt-3 text-2xl text-[#dce9e4]">Welcome back — see you at the service.</p>
            </div>
          ) : null}

          {outcome === "failed" ? (
            <div className="flex flex-col items-center">
              <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[#e2b9bb]/20 ring-4 ring-[#e2b9bb]">
                <svg viewBox="0 0 24 24" className="h-10 w-10 text-[#e2b9bb]" fill="none" stroke="currentColor" strokeWidth="3">
                  <path d="M12 8v5" />
                  <path d="M12 16.5h.01" />
                  <circle cx="12" cy="12" r="9" />
                </svg>
              </span>
              <h1 className="mt-4 font-[var(--font-heading)] text-4xl leading-tight md:text-5xl">
                Scan incomplete
              </h1>
              <p className="mt-3 text-2xl text-[#dce9e4]">
                We could not complete your scan. Please see the attendance desk — we will help you from there.
              </p>
            </div>
          ) : null}
        </div>

        {/* Live camera mirror: native camera when the kiosk runs on the
            scanner machine; otherwise the preview frames streamed by the
            operator console (remote display fallback). */}
        <div className="relative mt-7 w-full overflow-hidden rounded-3xl border-2 border-white/20 bg-black/40 shadow-[0_24px_60px_rgba(0,0,0,0.35)]">
          <div className="relative aspect-[4/3] w-full md:aspect-[16/9]">
            {cameraState === "native" ? (
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="h-full w-full scale-x-[-1] object-cover"
              />
            ) : frame ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={frame} alt="Live scanner camera preview" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-[#9db8ae]">
                <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <rect x="3" y="6" width="13" height="12" rx="2" />
                  <path d="m16 10 5-3v10l-5-3" />
                </svg>
                <p className="text-lg">
                  {cameraState === "requesting"
                    ? "Starting camera..."
                    : cameraState === "unavailable" && frame
                      ? "Using streamed preview from the scanner console..."
                      : "Waiting for the scanner camera..."}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Scanner status strip */}
        <div className="mt-4 w-full">
          <div
            className={`inline-flex max-w-full items-center gap-3 rounded-full border px-6 py-3 backdrop-blur ${
              statusLine ? STATUS_STYLES[statusLine.kind] : "border-white/20 bg-white/10 text-[#dce9e4]"
            }`}
          >
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                statusLine?.kind === "success"
                  ? "bg-[#7ee2b8]"
                  : statusLine?.kind === "error"
                    ? "bg-[#f0a028]"
                    : "bg-[#bcd2c9]"
              }`}
            />
            <span className="truncate text-xl font-semibold md:text-2xl">
              {statusLine?.message ?? "Standing by..."}
            </span>
          </div>
          {idle ? (
            <p className="mt-5 text-xl text-[#dce9e4] md:text-2xl">
              Please stand in front of the camera to have your attendance recorded.
            </p>
          ) : null}
        </div>
      </div>

      <div className="absolute bottom-5 left-0 right-0 flex items-center justify-between px-6 text-xs text-[#9db8ae]">
        <span className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-[#7ee2b8]" : "bg-[#f0a028]"}`} />
          {connected ? "Display connected" : "Reconnecting..."}
          {wakeLockActive ? " • Screen lock on" : ""}
        </span>
        <span className="flex items-center gap-3">
          {!fullscreen ? (
            <button
              type="button"
              className="rounded-full border border-white/20 bg-white/10 px-4 py-1.5 font-semibold text-[#dce9e4] backdrop-blur hover:bg-white/20"
              onClick={() => void toggleFullscreen()}
            >
              Go Fullscreen
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-full border border-white/10 px-3 py-1.5 font-semibold text-[#8fa89d] hover:text-[#dce9e4]"
            onClick={() => router.replace("/attendance")}
          >
            Exit kiosk
          </button>
        </span>
      </div>

      {!hasSupabaseEnv ? (
        <div className="absolute inset-x-0 bottom-16 flex justify-center">
          <p className="rounded-xl bg-[#3a2527]/80 px-4 py-2 text-sm text-[#e2b9bb]">
            {supabaseEnvIssue ?? "Missing Supabase environment values."}
          </p>
        </div>
      ) : null}
    </main>
  );
}
