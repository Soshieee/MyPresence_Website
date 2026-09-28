"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { hasSupabaseEnv, supabase, supabaseEnvIssue } from "@/lib/supabase";

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [verseIndex, setVerseIndex] = useState(() => Math.floor(Math.random() * VERSES.length));

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

        <div className="relative space-y-6">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#dce9e4] backdrop-blur">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#7ee2b8]" />
            Live attendance system
          </p>
          <h1 className="max-w-md font-[var(--font-heading)] text-5xl leading-[1.05] tracking-tight text-white">
            Know who&apos;s in the room.
          </h1>
          <p className="max-w-md text-base leading-relaxed text-[#cfdfd8]">
            Face-scan check-ins, newcomer care, and ministry analytics — built for Sunday services, prayer meetings, and events.
          </p>
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
          <div className="grid max-w-md grid-cols-3 gap-3">
            {[
              { step: "01", label: "Gather" },
              { step: "02", label: "Belong" },
              { step: "03", label: "Serve" }
            ].map((item) => (
              <div key={item.step} className="rounded-2xl border border-white/15 bg-white/[0.07] px-4 py-3 backdrop-blur">
                <p className="font-[var(--font-heading)] text-lg text-white">{item.step}</p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#cfdfd8]">{item.label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex flex-wrap items-center gap-2">
          {["Sunday Service", "Events", "Prayer Meeting"].map((item) => (
            <span key={item} className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold text-[#e6f0ec] backdrop-blur">
              {item}
            </span>
          ))}
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
          </div>
        </form>
      </section>
    </div>
  );
}
