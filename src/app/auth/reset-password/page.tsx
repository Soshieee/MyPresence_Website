"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppNotification, { AppNotificationTone } from "@/components/app-notification";
import { hasSupabaseEnv, supabase, supabaseEnvIssue } from "@/lib/supabase";
import { firstPasswordIssue, passwordRequirementStatuses } from "@/lib/password";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [notification, setNotification] = useState<{ tone: AppNotificationTone; message: string } | null>(null);

  useEffect(() => {
    if (!hasSupabaseEnv) return;

    const checkRecoverySession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setReady(Boolean(session));
      if (!session) setError("This reset link is invalid or has expired. Request a new link from the Login page.");
    };

    void checkRecoverySession();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") setReady(Boolean(session));
    });

    return () => subscription.unsubscribe();
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setNotification(null);

    const passwordIssue = firstPasswordIssue(password);
    if (passwordIssue) {
      setError(passwordIssue);
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (updateError) {
      setError(updateError.message || "Unable to update your password.");
      return;
    }

    await supabase.auth.signOut();
    setNotification({ tone: "success", message: "Your password was updated successfully. You can now sign in." });
    setPassword("");
    setConfirmPassword("");
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#e9e9e9] px-6 py-10">
      <form onSubmit={onSubmit} className="w-full max-w-md rounded-3xl border border-[#c3d0cb] bg-white/85 p-8 shadow-[0_18px_36px_rgba(56,91,79,0.14)]">
        <h1 className="text-center font-[var(--font-heading)] text-3xl text-[#22332d]">Reset Password</h1>
        <p className="mt-2 text-center text-sm text-[#5d7269]">Choose a new password for your MyPresence account.</p>
        {!hasSupabaseEnv ? <p className="mt-4 status-error">{supabaseEnvIssue}</p> : null}
        {error ? <p className="mt-4 status-error">{error}</p> : null}
        <div className="mt-7 space-y-4">
          <div>
            <label className="field-label" htmlFor="new-password">New Password</label>
            <div className="relative">
              <input id="new-password" className="field-input pr-20" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} required disabled={!ready} autoComplete="new-password" />
              <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#527064]" onClick={() => setShowPassword((value) => !value)}>
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            <ul className="mt-2.5 grid gap-1.5" aria-label="Password requirements">
              {passwordRequirementStatuses(password).map((requirement) => (
                <li key={requirement.key} className="flex items-center gap-2 text-xs">
                  <span
                    aria-hidden="true"
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
                      requirement.met
                        ? "border-[#385b4f] bg-[#385b4f] text-white"
                        : "border-[#b9cac3] bg-white text-transparent"
                    }`}
                  >
                    <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3.5">
                      <path d="m5 12 4.5 4.5L19 7" />
                    </svg>
                  </span>
                  <span className={requirement.met ? "font-semibold text-[#315349]" : "text-[#6a7e76]"}>
                    {requirement.label}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <label className="field-label" htmlFor="confirm-new-password">Confirm New Password</label>
            <input id="confirm-new-password" className="field-input" type={showPassword ? "text" : "password"} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required disabled={!ready} autoComplete="new-password" />
          </div>
        </div>
        <button type="submit" className="btn-primary mt-6 w-full" disabled={!ready || submitting || !hasSupabaseEnv}>
          {submitting ? "Updating..." : "Update Password"}
        </button>
        <button type="button" className="mt-3 w-full text-xs font-semibold text-[#527064] hover:text-[#22332d]" onClick={() => router.replace("/login")}>
          Return to Login
        </button>
      </form>
      {notification ? <AppNotification tone={notification.tone} message={notification.message} onDismiss={() => setNotification(null)} /> : null}
    </main>
  );
}
