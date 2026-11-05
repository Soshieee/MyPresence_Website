"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import AppNotification, { AppNotificationTone } from "@/components/app-notification";
import { hasSupabaseEnv, supabase, supabaseEnvIssue } from "@/lib/supabase";

type LoginApiResult = {
  ok?: boolean;
  error?: string;
  message?: string;
  code?: string;
  warning?: string;
  remainingAttempts?: number;
  retryAfterSeconds?: number;
  access_token?: string;
  refresh_token?: string;
};

function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const VERSES = [
  {
    text: "For where two or three gather in my name, there am I with them.",
    ref: "Matthew 18:20"
  },
  {
    text: "And let us not give up meeting together, but encourage one another.",
    ref: "Hebrews 10:25"
  },
  {
    text: "How good and pleasant it is when God's people live together in unity.",
    ref: "Psalm 133:1"
  },
  {
    text: "Every day they continued to meet together in the temple courts.",
    ref: "Acts 2:46"
  },
  {
    text: "So in Christ we, though many, form one body, and each member belongs to the others.",
    ref: "Romans 12:5"
  }
];

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup" | "forgot" | "verify" | "reset-verify" | "reset-password">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [lockoutNow, setLockoutNow] = useState(0);
  const [notification, setNotification] = useState<{ tone: AppNotificationTone; message: string } | null>(null);
  // Start from a stable value so server and client render the same verse.
  // The interval below still rotates through the rest.
  const [verseIndex, setVerseIndex] = useState(0);

  useEffect(() => {
    if (!hasSupabaseEnv) return;

    let mounted = true;
    const checkSession = async () => {
      const {
        data: { session }
      } = await supabase.auth.getSession();

      if (!mounted) return;
      if (session) router.replace("/");
    };

    void checkSession();

    return () => {
      mounted = false;
    };
  }, [router]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setVerseIndex((prev) => (prev + 1) % VERSES.length);
    }, 12000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!lockoutUntil) return;

    const id = window.setInterval(() => {
      const now = Date.now();
      setLockoutNow(now);
      if (now >= lockoutUntil) setLockoutUntil(null);
    }, 1000);

    return () => window.clearInterval(id);
  }, [lockoutUntil]);

  const lockoutRemaining = lockoutUntil
    ? Math.max(0, Math.ceil((lockoutUntil - lockoutNow) / 1000))
    : 0;

  const resetFeedback = () => {
    setError("");
    setWarning("");
    setNotification(null);
  };

  const switchMode = (nextMode: "login" | "signup" | "forgot" | "verify" | "reset-verify" | "reset-password") => {
    setMode(nextMode);
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    resetFeedback();
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (!hasSupabaseEnv) {
      setError(supabaseEnvIssue ?? "Missing Supabase environment values.");
      return;
    }

    if (mode === "login" && lockoutRemaining > 0) {
      setError(`Too many failed attempts. Try again in ${formatCountdown(lockoutRemaining)}.`);
      return;
    }

    setSubmitting(true);
    resetFeedback();

    if (mode === "verify" || mode === "reset-verify") {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: verificationCode.trim(),
        type: mode === "verify" ? "signup" : "recovery"
      });

      setSubmitting(false);
      if (verifyError) {
        setError(verifyError.message || "The verification code is invalid or expired.");
        return;
      }

      if (mode === "verify") {
        setNotification({
          tone: "success",
          message: "Email verified. Your application is now waiting for administrator review."
        });
        setMode("login");
      } else {
        setNotification({ tone: "success", message: "Code verified. Choose a new password." });
        setMode("reset-password");
      }
      setVerificationCode("");
      return;
    }

    if (mode === "forgot") {
      let response: Response;

      try {
        response = await fetch("/api/auth/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim() })
        });
      } catch {
        setSubmitting(false);
        setError("Unable to reach the password reset service. Please try again.");
        return;
      }

      const result = await response.json().catch(() => ({})) as LoginApiResult;
      setSubmitting(false);

      if (!response.ok) {
        setError(result.error || "Unable to process the password reset request.");
        return;
      }

      setNotification({
        tone: "success",
        message: result.message || "A password reset code has been sent."
      });
      setMode("reset-verify");
      return;
    }

    if (mode === "reset-password") {
      if (password.length < 8) {
        setError("Password must be at least 8 characters long.");
        setSubmitting(false);
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        setSubmitting(false);
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password });
      setSubmitting(false);
      if (updateError) {
        setError(updateError.message || "Unable to update your password.");
        return;
      }

      await supabase.auth.signOut();
      setPassword("");
      setConfirmPassword("");
      setNotification({ tone: "success", message: "Password updated successfully. You can now sign in." });
      setMode("login");
      return;
    }

    if (mode === "signup") {
      if (!firstName.trim() || !lastName.trim()) {
        setError("First name and last name are required.");
        setSubmitting(false);
        return;
      }
      if (password.length < 8) {
        setError("Password must be at least 8 characters long.");
        setSubmitting(false);
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        setSubmitting(false);
        return;
      }

      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          password
        })
      });
      const result = await response.json().catch(() => ({}));
      setSubmitting(false);

      if (!response.ok) {
        setError(typeof result.error === "string" ? result.error : "Registration failed.");
        return;
      }

      setNotification({
        tone: "success",
        message: "Account created. Enter the verification code sent to your email."
      });
      setMode("verify");
      setPassword("");
      setConfirmPassword("");
      return;
    }

    let response: Response;

    try {
      response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password })
      });
    } catch {
      setSubmitting(false);
      setError("Unable to reach the sign-in service. Please try again.");
      return;
    }

    const result = await response.json().catch(() => ({})) as LoginApiResult;

    if (!response.ok) {
      setSubmitting(false);

      if (result.code === "ACCOUNT_LOCKED" && typeof result.retryAfterSeconds === "number") {
        const now = Date.now();
        setLockoutNow(now);
        setLockoutUntil(now + result.retryAfterSeconds * 1000);
      }

      setError(result.error || "Login failed. Please try again.");
      if (result.warning) setWarning(result.warning);
      return;
    }

    if (!result.access_token || !result.refresh_token) {
      setSubmitting(false);
      setError("Sign-in completed but the session could not be established. Please try again.");
      return;
    }

    const { error: sessionError } = await supabase.auth.setSession({
      access_token: result.access_token,
      refresh_token: result.refresh_token
    });

    setSubmitting(false);

    if (sessionError) {
      setError(sessionError.message || "Unable to establish your session. Please try again.");
      return;
    }

    setLockoutUntil(null);
    setWarning("");
    router.replace("/");
  };

  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <section className="relative hidden overflow-hidden md:flex md:flex-col md:justify-between md:p-12">
        <div className="absolute inset-0 bg-gradient-to-br from-[#1e2f29] via-[#2f4e44] to-[#385b4f]" />
        <div className="absolute -left-20 -top-20 h-80 w-80 rounded-full bg-[#6c8e82]/25 blur-3xl" />
        <div className="absolute -bottom-24 -right-16 h-96 w-96 rounded-full bg-[#16241f]/60 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.14]"
          style={{
            backgroundImage: "radial-gradient(rgba(255,255,255,0.55) 1px, transparent 1px)",
            backgroundSize: "26px 26px"
          }}
        />
        <div className="absolute -right-24 top-1/3 h-64 w-64 rounded-full border border-white/10" />
        <div className="absolute -right-16 top-1/3 h-64 w-64 translate-x-6 rounded-full border border-white/10" />

        <div className="relative flex items-center gap-4">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/20 bg-white/10 p-2 shadow-[0_10px_30px_rgba(0,0,0,0.25)] backdrop-blur">
            <Image
              src="/logo.png"
              alt="MyPresence logo"
              width={56}
              height={56}
              className="h-12 w-12 object-contain brightness-0 invert"
              priority
            />
          </span>
          <span>
            <span className="block font-[var(--font-heading)] text-2xl tracking-tight text-white">MyPresence</span>
            <span className="mt-1 block text-[11px] font-semibold uppercase tracking-[0.22em] text-[#bcd2c9]">HPCI Thrive</span>
          </span>
        </div>

        <div className="relative flex flex-1 flex-col justify-center space-y-6">
          <p className="inline-flex self-start items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#dce9e4] backdrop-blur">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#7ee2b8]" />
            Live attendance system
          </p>
          <h1 className="max-w-md font-[var(--font-heading)] text-5xl leading-[1.05] tracking-tight text-white">
            Know who&apos;s in the room.
          </h1>
          <figure className="max-w-md rounded-2xl border border-white/15 bg-white/[0.07] p-5 backdrop-blur">
            <blockquote
              key={verseIndex}
              className="font-[var(--font-heading)] text-xl leading-snug text-white"
            >
              “{VERSES[verseIndex].text}”
            </blockquote>
            <figcaption className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#bcd2c9]">
              {VERSES[verseIndex].ref}
            </figcaption>
          </figure>
          <div className="inline-flex max-w-md items-center rounded-full border border-white/15 bg-white/[0.07] px-5 py-3 backdrop-blur">
            <p className="font-[var(--font-heading)] text-lg tracking-wide text-white">
              Gather, belong, and serve.
            </p>
          </div>
        </div>

      </section>

      <section className="flex items-center justify-center bg-[#e9e9e9] px-6 py-10">
        <form onSubmit={onSubmit} className="w-full max-w-md rounded-3xl border border-[#c3d0cb] bg-white/85 p-8 shadow-[0_18px_36px_rgba(56,91,79,0.14)] backdrop-blur">
          <h2 className="text-center font-[var(--font-heading)] text-3xl text-[#22332d]">
            {mode === "login"
              ? "Welcome Back"
              : mode === "signup"
                ? "Create Account"
                : mode === "verify" || mode === "reset-verify"
                  ? "Verify Email"
                  : "Reset Password"}
          </h2>
          <p className="mt-2 text-center text-sm text-[#5d7269]">
            {mode === "login"
              ? "Sign in with your admin account to access dashboard pages."
              : mode === "signup"
                ? "Create a Web Admin Account application for administrator review."
                : mode === "verify" || mode === "reset-verify"
                  ? `Enter the 8-digit code sent to ${email}.`
                  : mode === "reset-password"
                    ? "Choose a new password for your MyPresence account."
                    : "Enter your email and we will send a secure reset code if an account exists."}
          </p>

          {!hasSupabaseEnv ? <p className="mt-4 status-error">{supabaseEnvIssue}</p> : null}
          {error ? <p className="mt-4 status-error">{error}</p> : null}
          {warning ? (
            <p className="mt-3 rounded-xl border border-[#e5cf93] bg-[#fffaf0] px-4 py-3 text-sm text-[#7a5a17]" role="status">
              {warning}
            </p>
          ) : null}

          <div className="mt-7 space-y-4">
            {mode === "signup" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="field-label" htmlFor="first-name">First Name</label>
                  <input id="first-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="field-input" autoComplete="given-name" required />
                </div>
                <div>
                  <label className="field-label" htmlFor="last-name">Last Name</label>
                  <input id="last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} className="field-input" autoComplete="family-name" required />
                </div>
              </div>
            ) : null}
            {mode !== "verify" && mode !== "reset-verify" ? (
            <div>
              <label className="field-label" htmlFor="login-email">Email</label>
              <input id="login-email" value={email} onChange={(e) => setEmail(e.target.value)} className="field-input" type="email" required autoComplete="email" />
            </div>
            ) : null}
            {mode === "verify" || mode === "reset-verify" ? (
              <div>
                <label className="field-label" htmlFor="verification-code">Verification Code</label>
                <input
                  id="verification-code"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  className="field-input text-center text-lg tracking-[0.35em]"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  required
                />
              </div>
            ) : null}
            {mode !== "forgot" && mode !== "verify" && mode !== "reset-verify" ? (
              <>
                <div>
                  <label className="field-label" htmlFor="login-password">Password</label>
                  <div className="relative">
                    <input id="login-password" value={password} onChange={(e) => setPassword(e.target.value)} className="field-input pr-20" type={showPassword ? "text" : "password"} required autoComplete={mode === "signup" ? "new-password" : "current-password"} />
                    <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#527064]" onClick={() => setShowPassword((value) => !value)}>
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>
                {mode === "signup" ? (
                  <div>
                    <label className="field-label" htmlFor="confirm-password">Confirm Password</label>
                    <input id="confirm-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="field-input" type={showPassword ? "text" : "password"} required autoComplete="new-password" />
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="mt-6 flex flex-col gap-3">
            <button
              type="submit"
              className="btn-primary w-full"
              disabled={submitting || !hasSupabaseEnv || (mode === "login" && lockoutRemaining > 0)}
            >
              {mode === "login" && lockoutRemaining > 0
                ? `Try again in ${formatCountdown(lockoutRemaining)}`
                : submitting
                  ? mode === "login"
                    ? "Signing in..."
                    : mode === "signup"
                      ? "Creating account..."
                      : mode === "verify" || mode === "reset-verify"
                        ? "Verifying..."
                        : mode === "reset-password"
                          ? "Updating..."
                          : "Sending code..."
                  : mode === "login"
                    ? "Enter Dashboard"
                    : mode === "signup"
                      ? "Create Account"
                      : mode === "verify" || mode === "reset-verify"
                        ? "Verify Email"
                        : mode === "reset-password"
                          ? "Update Password"
                          : "Send Reset Code"}
            </button>
            {mode === "verify" || mode === "reset-verify" ? (
              <button
                type="button"
                className="text-xs font-semibold text-[#527064] hover:text-[#22332d]"
                disabled={submitting}
                onClick={async () => {
                  setSubmitting(true);
                  resetFeedback();

                  if (mode === "verify") {
                    const { error: resendError } = await supabase.auth.resend({
                      type: "signup",
                      email: email.trim()
                    });

                    setSubmitting(false);
                    if (resendError) {
                      setError(resendError.message || "Unable to resend the verification code.");
                      return;
                    }

                    setNotification({ tone: "success", message: "A new verification code was sent." });
                    return;
                  }

                  let response: Response;

                  try {
                    response = await fetch("/api/auth/forgot-password", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ email: email.trim() })
                    });
                  } catch {
                    setSubmitting(false);
                    setError("Unable to reach the password reset service. Please try again.");
                    return;
                  }

                  const result = await response.json().catch(() => ({})) as LoginApiResult;
                  setSubmitting(false);

                  if (!response.ok) {
                    setError(result.error || "Unable to resend the password reset code.");
                    return;
                  }

                  setNotification({
                    tone: "success",
                    message: result.message || "A password reset code has been sent."
                  });
                }}
              >
                {mode === "verify" ? "Resend verification code" : "Resend reset code"}
              </button>
            ) : null}
            {mode === "login" ? (
              <div className="flex items-center justify-between text-xs font-semibold text-[#527064]">
                <button type="button" className="hover:text-[#22332d]" onClick={() => switchMode("signup")}>Create Account</button>
                <button type="button" className="hover:text-[#22332d]" onClick={() => switchMode("forgot")}>Forgot Password?</button>
              </div>
            ) : mode !== "verify" && mode !== "reset-verify" && mode !== "reset-password" ? (
              <button type="button" className="text-xs font-semibold text-[#527064] hover:text-[#22332d]" onClick={() => switchMode("login")}>
                Return to Login
              </button>
            ) : (
              <button type="button" className="text-xs font-semibold text-[#527064] hover:text-[#22332d]" onClick={() => switchMode("login")}>
                Return to Login
              </button>
            )}
          </div>

          <p className="mt-6 text-center text-[11px] leading-5 text-[#5d7269]">
            By continuing, you agree to our{" "}
            <Link href="/terms" className="font-semibold text-[#35564a] underline-offset-2 hover:underline">
              Terms and Conditions
            </Link>{" "}
            and acknowledge our{" "}
            <Link href="/privacy" className="font-semibold text-[#35564a] underline-offset-2 hover:underline">
              Privacy Notice
            </Link>
            .
          </p>
        </form>
      </section>
      {notification ? <AppNotification tone={notification.tone} message={notification.message} onDismiss={() => setNotification(null)} /> : null}
    </div>
  );
}
