"use client";

// P6 — Account activation page for invited users.
// An administrator invites the account; Supabase Auth sends the activation
// link (via the project's Brevo SMTP). Clicking it establishes a session and
// lands here, where the invited person sets their own password. Password
// rules match the rest of the app and are enforced client-side here and
// server-side by Supabase Auth. Accounts start as regular users — admin
// promotion is a separate step in the Verification Center.

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppNotification, { AppNotificationTone } from "@/components/app-notification";
import { hasSupabaseEnv, supabase, supabaseEnvIssue } from "@/lib/supabase";
import { firstPasswordIssue, passwordRequirementStatuses } from "@/lib/password";
import { setSessionHint } from "@/lib/session-hint";

export default function CompleteInvitePage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [notification, setNotification] = useState<{ tone: AppNotificationTone; message: string } | null>(null);

  useEffect(() => {
    const active = true;

    const checkSession = async () => {
      if (!hasSupabaseEnv) {
        if (active) {
          setError(supabaseEnvIssue ?? "Missing Supabase configuration.");
          setChecking(false);
        }
        return;
      }

      const {
        data: { session }
      } = await supabase.auth.getSession();
      const {
        data: { user }
      } = await supabase.auth.getUser();

      if (!active) return;
      setChecking(false);

      if (session && user) {
        setHasSession(true);
        setEmail(user.email ?? "");
        // Mark the invitation accepted as soon as the activation link is used.
        void supabase.rpc("mark_invitation_accepted");
      } else {
        setHasSession(false);
        setError(
          "This invitation link is invalid or has expired. Ask your administrator to send a new invitation."
        );
      }
    };

    void checkSession();
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event, session) => {
      // Invite links establish the session asynchronously after mount; react
      // when it arrives.
      if (event === "SIGNED_IN" && session) void checkSession();
      if (event === "SIGNED_OUT") {
        setHasSession(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

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
      setError(updateError.message || "Unable to set your password.");
      return;
    }

    await supabase.rpc("mark_invitation_accepted");
    setSessionHint();
    setDone(true);
    setNotification({
      tone: "success",
      message: "Your account is ready. Welcome to MyPresence!"
    });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#e9e9e9] px-6 py-10">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-3xl border border-[#c3d0cb] bg-white/85 p-8 shadow-[0_18px_36px_rgba(56,91,79,0.14)]"
      >
        <h1 className="text-center font-[var(--font-heading)] text-3xl text-[#22332d]">
          Activate Your Account
        </h1>
        <p className="mt-2 text-center text-sm text-[#5d7269]">
          {done
            ? "Everything is set. Your MyPresence account is ready to use."
            : hasSession
              ? `Set your password for ${email || "your new account"} to finish setting up MyPresence.`
              : "You have been invited to access MyPresence, the attendance and event management system of HPCI Thrive."}
        </p>

        {!hasSupabaseEnv ? <p className="mt-4 status-error">{supabaseEnvIssue}</p> : null}
        {checking ? <p className="mt-4 status-info">Checking your invitation...</p> : null}
        {error ? <p className="mt-4 status-error">{error}</p> : null}

        {hasSession && !done && !checking ? (
          <>
            <div className="mt-7 space-y-4">
              <div>
                <label className="field-label" htmlFor="invite-password">
                  New Password
                </label>
                <div className="relative">
                  <input
                    id="invite-password"
                    className="field-input pr-20"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#527064]"
                    onClick={() => setShowPassword((value) => !value)}
                  >
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
                <label className="field-label" htmlFor="invite-confirm-password">
                  Confirm New Password
                </label>
                <input
                  id="invite-confirm-password"
                  className="field-input"
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>
            </div>

            <button type="submit" className="btn-primary mt-6 w-full" disabled={submitting}>
              {submitting ? "Activating..." : "Activate Account"}
            </button>
            <p className="mt-3 text-center text-[11px] text-[#71847c]">
              This account was issued by an administrator and includes full MyPresence access.
            </p>
          </>
        ) : null}

        {done ? (
          <button
            type="button"
            className="btn-primary mt-6 w-full"
            onClick={() => router.replace("/")}
          >
            Continue to MyPresence
          </button>
        ) : null}

        {!hasSession && !checking ? (
          <Link href="/login" className="btn-ghost mt-6 block w-full text-center">
            Return to Login
          </Link>
        ) : null}
      </form>
      {notification ? (
        <AppNotification tone={notification.tone} message={notification.message} onDismiss={() => setNotification(null)} />
      ) : null}
    </main>
  );
}
