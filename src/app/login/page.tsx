"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("********");

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
  };

  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <section className="relative hidden overflow-hidden bg-[#385b4f] md:flex md:flex-col md:justify-between md:p-12">
        <div className="absolute -left-14 top-10 h-64 w-64 rounded-full bg-[#6c8e82]/30 blur-3xl" />
        <div className="absolute bottom-16 right-4 h-72 w-72 rounded-full bg-[#2f4e44]/50 blur-3xl" />
        <p className="relative text-xs font-semibold uppercase tracking-[0.18em] text-[#dce9e4]">MyPresence Platform</p>
        <div className="relative space-y-4">
          <h1 className="font-[var(--font-heading)] text-6xl font-semibold tracking-tight text-white">MyPresence</h1>
          <p className="max-w-md text-lg text-[#d9e8e2]">Church attendance intelligence with face scan, newcomer tracking, and event analytics.</p>
        </div>
        <div className="relative rounded-2xl border border-[#8ca89f] bg-[#43685c]/60 p-4 text-sm text-[#e3efea]">
          Tip: Use Event Manager to publish posters directly on your dashboard home.
        </div>
      </section>

      <section className="flex items-center justify-center bg-[#e9e9e9] px-6 py-10">
        <form onSubmit={onSubmit} className="w-full max-w-md rounded-3xl border border-[#c3d0cb] bg-white/85 p-8 shadow-[0_18px_36px_rgba(56,91,79,0.14)] backdrop-blur">
          <h2 className="text-center font-[var(--font-heading)] text-3xl font-semibold text-[#22332d]">Welcome Back</h2>
          <p className="mt-2 text-center text-sm text-[#5d7269]">Sign in to manage attendance and event analytics.</p>

          <div className="mt-7 space-y-4">
            <div>
              <label className="field-label">Email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} className="field-input" type="email" />
            </div>
            <div>
              <label className="field-label">Password</label>
              <input value={password} onChange={(e) => setPassword(e.target.value)} className="field-input" type="password" />
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3">
            <Link href="/" className="btn-primary w-full">
              Enter Dashboard
            </Link>
            <p className="text-center text-xs text-[#698177]">Demo mode enabled. Authentication can be connected later.</p>
          </div>
        </form>
      </section>
    </div>
  );
}
