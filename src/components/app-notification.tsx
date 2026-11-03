"use client";

import { useEffect } from "react";

export type AppNotificationTone = "success" | "error" | "warning";

type AppNotificationProps = {
  tone: AppNotificationTone;
  message: string;
  onDismiss?: () => void;
  title?: string;
  variant?: "toast" | "dialog";
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  busy?: boolean;
};

const toneStyles: Record<AppNotificationTone, { icon: string; label: string; classes: string }> = {
  success: {
    icon: "✓",
    label: "Success",
    classes: "border-[#9fc6b7] bg-[#f4fbf7] text-[#245142]"
  },
  error: {
    icon: "!",
    label: "Error",
    classes: "border-[#e2b9bb] bg-[#fff7f7] text-[#7a3237]"
  },
  warning: {
    icon: "!",
    label: "Notice",
    classes: "border-[#e5cf93] bg-[#fffaf0] text-[#7a5a17]"
  }
};

export default function AppNotification({
  tone,
  message,
  onDismiss,
  title,
  variant = "toast",
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  busy = false
}: AppNotificationProps) {
  const isDialog = variant === "dialog";
  const dismiss = onDismiss ?? (() => undefined);

  useEffect(() => {
    if (isDialog || !onDismiss) return;
    const timeoutId = window.setTimeout(onDismiss, 3500);
    return () => window.clearTimeout(timeoutId);
  }, [isDialog, message, onDismiss]);

  const style = toneStyles[tone];

  return (
    <div className={`fixed inset-0 z-[70] flex items-center justify-center px-4 ${isDialog ? "bg-[#1b2a25]/45" : "pointer-events-none"}`} aria-live={isDialog ? undefined : "polite"}>
      <div
        className={`${isDialog ? "w-full max-w-md rounded-2xl bg-[#fbf7f2] p-5 shadow-[0_22px_55px_rgba(31,52,44,0.24)]" : "pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border px-4 py-3 shadow-[0_18px_45px_rgba(31,52,44,0.2)]"} app-notification-enter ${isDialog ? "border-[#d8c3c5]" : style.classes}`}
        role={isDialog ? "dialog" : "alert"}
        aria-modal={isDialog ? true : undefined}
      >
        <div className={isDialog ? "space-y-4" : "contents"}>
          {!isDialog ? (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-current/10 text-lg font-bold" aria-hidden="true">
              {style.icon}
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            {isDialog && title ? <p className="font-[var(--font-heading)] text-xl text-[#3a282a]">{title}</p> : null}
            {!isDialog ? <p className="text-[10px] font-bold uppercase tracking-[0.12em] opacity-70">{style.label}</p> : null}
            <p className={`mt-0.5 text-sm ${isDialog ? "text-[#5b4547]" : "font-semibold"}`}>{message}</p>
          </div>
          {isDialog ? (
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={onCancel ?? dismiss} disabled={busy}>{cancelLabel ?? "Cancel"}</button>
              <button type="button" className="rounded-full bg-[#8a3f46] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#73343a] disabled:opacity-50" onClick={onConfirm} disabled={busy}>
                {busy ? "Working..." : confirmLabel ?? "Confirm"}
              </button>
            </div>
          ) : null}
        </div>
        {!isDialog ? <button type="button" className="rounded-full p-1 text-lg leading-none opacity-60 transition hover:bg-black/5 hover:opacity-100" onClick={dismiss} aria-label="Dismiss notification">×</button> : null}
      </div>
    </div>
  );
}
