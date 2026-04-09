"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { hasSupabaseEnv, supabase, supabaseEnvIssue } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

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

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (!hasSupabaseEnv) {
      setError(supabaseEnvIssue ?? "Missing Supabase environment values.");
      return;
    }

    setSubmitting(true);
    setError("");

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password
    });

    if (signInError) {
      setError(signInError.message || "Login failed.");
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    router.replace("/");
  };

  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <section className="relative hidden overflow-hidden bg-[#385b4f] md:flex md:flex-col md:justify-between md:p-12">
        <div className="absolute -left-14 top-10 h-64 w-64 rounded-full bg-[#6c8e82]/30 blur-3xl" />
        <div className="absolute bottom-16 right-4 h-72 w-72 rounded-full bg-[#2f4e44]/50 blur-3xl" />
        <p className="relative text-xs font-semibold uppercase tracking-[0.18em] text-[#dce9e4]">MyPresence Platform</p>
        <div className="relative space-y-4">
          <h1 className="font-[var(--font-heading)] text-6xl tracking-tight text-white">MyPresence</h1>
          <p className="max-w-md text-lg text-[#d9e8e2]">Church attendance monitoring with face scan, newcomer tracking, and event analytics.</p>
        </div>
        <div className="relative rounded-2xl border border-[#8ca89f] bg-[#43685c]/60 p-4 text-sm text-[#e3efea]">
          Tip: Use Event Manager to publish posters directly on your dashboard home.
        </div>
      </section>

      <section className="flex items-center justify-center bg-[#e9e9e9] px-6 py-10">
        <form onSubmit={onSubmit} className="w-full max-w-md rounded-3xl border border-[#c3d0cb] bg-white/85 p-8 shadow-[0_18px_36px_rgba(56,91,79,0.14)] backdrop-blur">
          <h2 className="text-center font-[var(--font-heading)] text-3xl text-[#22332d]">Welcome Back</h2>
          <p className="mt-2 text-center text-sm text-[#5d7269]">Sign in with your admin account to access dashboard pages.</p>

          {!hasSupabaseEnv ? <p className="mt-4 status-error">{supabaseEnvIssue}</p> : null}
          {error ? <p className="mt-4 status-error">{error}</p> : null}

          <div className="mt-7 space-y-4">
            <div>
              <label className="field-label">Email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} className="field-input" type="email" required autoComplete="email" />
            </div>
            <div>
              <label className="field-label">Password</label>
              <input value={password} onChange={(e) => setPassword(e.target.value)} className="field-input" type="password" required autoComplete="current-password" />
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3">
            <button type="submit" className="btn-primary w-full" disabled={submitting || !hasSupabaseEnv}>
              {submitting ? "Signing in..." : "Enter Dashboard"}
            </button>
            <p className="text-center text-xs text-[#698177]">Use an admin email/password created in Supabase Auth.</p>
          </div>
        </form>
      </section>
    </div>
  );
}
