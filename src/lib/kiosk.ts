// P5 — Kiosk display shared vocabulary.
// The operator console publishes scan outcomes; the public kiosk page only
// listens. The payload carries the minimum information needed for the public
// confirmation: an outcome, the member's FIRST name, and the attendance type.
// Never send student IDs, tokens, or administrative data across this channel.

export const KIOSK_CHANNEL = "mypresence-scan-kiosk";
export const KIOSK_BROADCAST_EVENT = "scan";
export const KIOSK_STATUS_EVENT = "status";
export const KIOSK_FRAME_EVENT = "frame";
export const KIOSK_RESET_MS = 6000;

export type KioskScanOutcome = "recognized" | "duplicate" | "failed";

export type KioskScanPayload = {
  outcome: KioskScanOutcome;
  firstName: string | null;
  context: string | null;
  at: string;
};

export type KioskStatusKind = "info" | "success" | "error";

export type KioskStatusPayload = {
  kind: KioskStatusKind;
  message: string;
  at: string;
};

export type KioskFramePayload = {
  frame: string;
  at: string;
};

export function toKioskFirstName(fullName: string | null | undefined): string | null {
  const first = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first) return null;
  return first.slice(0, 40);
}

// Scanner status messages are user-facing, but a few contain technical
// internals (database errors, initialization failures). Those are replaced
// with a generic public-safe line before they reach the kiosk.
export function toKioskStatusMessage(message: string): string {
  const clean = message.trim().slice(0, 140);
  if (!clean) return "";
  if (
    /failed to (save|initialize|fetch|load|open)/i.test(clean) ||
    /supabase|column|relation|schema|permission/i.test(clean)
  ) {
    return "Scanner needs attention — please see the attendance desk.";
  }
  return clean;
}
