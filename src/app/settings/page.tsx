"use client";

import { useEffect, useState } from "react";
import { defaultAppSettings, loadAppSettings, saveAppSettings } from "@/lib/app-settings";
import { hasSupabaseEnv, supabase, supabaseEnvIssue } from "@/lib/supabase";

export default function SettingsPage() {
  const [newcomerClearScanCount, setNewcomerClearScanCount] = useState<1 | 2>(defaultAppSettings.newcomerClearScanCount);
  const [saved, setSaved] = useState(false);
  const [resetKey, setResetKey] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetStatus, setResetStatus] = useState("");

  useEffect(() => {
    const settings = loadAppSettings();
    setNewcomerClearScanCount(settings.newcomerClearScanCount);
  }, []);

  const onSave = () => {
    saveAppSettings({
      newcomerClearScanCount
    });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  const canReset = resetKey.trim().toUpperCase() === "RESET";

  const runReset = async (mode: "attendance" | "all") => {
    if (!hasSupabaseEnv) {
      setResetStatus(supabaseEnvIssue ?? "Missing Supabase env values.");
      return;
    }

    if (!canReset) {
      setResetStatus("Type RESET to unlock database reset.");
      return;
    }

    setResetting(true);
    setResetStatus("");

    try {
      const attendanceDelete = await supabase.from("attendance").delete().not("id", "is", null);
      if (attendanceDelete.error) throw attendanceDelete.error;

      if (mode === "all") {
        const eventsDelete = await supabase.from("events").delete().not("id", "is", null);
        if (eventsDelete.error) throw eventsDelete.error;

        const usersDelete = await supabase.from("users").delete().not("id", "is", null);
        if (usersDelete.error) throw usersDelete.error;
      }

      setResetStatus(mode === "all" ? "Database reset complete: users, attendance, and events cleared." : "Attendance data cleared.");
      setResetKey("");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown reset error.";
      setResetStatus(`Reset failed: ${message}`);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-6 reveal">
      <section>
        <h1 className="page-title font-[var(--font-heading)]">Settings</h1>
        <p className="page-subtitle">Configure behavior for scanning and newcomer handling.</p>
      </section>

      <section className="space-y-4">
        <div className="analytics-panel">
          <h2 className="font-[var(--font-heading)] text-xl font-semibold text-[#22332d]">Scan Settings</h2>
          <div className="mt-4 space-y-4 rounded-2xl border border-[#b9cac3] bg-white/75 p-4 text-[#35564a]">
            <div>
              <p className="text-sm font-semibold">Remove newcomer tag after</p>
              <div className="mt-2 flex gap-2">
                <button
                  className={newcomerClearScanCount === 1 ? "btn-primary" : "btn-ghost"}
                  onClick={() => setNewcomerClearScanCount(1)}
                  type="button"
                >
                  1 scan
                </button>
                <button
                  className={newcomerClearScanCount === 2 ? "btn-primary" : "btn-ghost"}
                  onClick={() => setNewcomerClearScanCount(2)}
                  type="button"
                >
                  2 scans
                </button>
              </div>
            </div>

            <button type="button" className="btn-primary" onClick={onSave}>
              Save Settings
            </button>
            {saved ? <p className="text-sm font-semibold text-[#2d5a4b]">Saved.</p> : null}
          </div>
        </div>

        <div className="analytics-panel">
          <h2 className="font-[var(--font-heading)] text-xl font-semibold text-[#22332d]">Danger Zone</h2>
          <div className="mt-4 space-y-3 rounded-2xl border border-[#e0b8bb] bg-[#fff7f7] p-4 text-[#5b3135]">
            <p className="text-sm font-semibold">Reset database data</p>
            <p className="text-xs text-[#744147]">
              This permanently deletes data. Type RESET to enable the reset buttons.
            </p>
            <input
              type="text"
              value={resetKey}
              onChange={(event) => setResetKey(event.target.value)}
              className="field-input max-w-[220px]"
              placeholder="Type RESET"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-ghost"
                disabled={!canReset || resetting}
                onClick={() => void runReset("attendance")}
              >
                Clear Attendance Only
              </button>
              <button
                type="button"
                className="rounded-full bg-[#b83f49] px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!canReset || resetting}
                onClick={() => void runReset("all")}
              >
                Full Reset (Users + Attendance + Events)
              </button>
            </div>
            {resetStatus ? <p className="text-sm font-semibold">{resetStatus}</p> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
