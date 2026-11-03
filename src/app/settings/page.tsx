"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { defaultAppSettings, loadAppSettings, saveAppSettings } from "@/lib/app-settings";
import { hasSupabaseEnv, supabase, supabaseEnvIssue } from "@/lib/supabase";

type Feedback = {
  tone: "success" | "error" | "info";
  message: string;
};

type AccountInfo = {
  email: string;
  id: string;
  lastSignInAt: string | null;
  provider: string | null;
};

function feedbackClass(tone: Feedback["tone"]) {
  if (tone === "success") return "status-success";
  if (tone === "error") return "status-error";
  return "status-info";
}

function formatTimestamp(value: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function SettingsPage() {
  const router = useRouter();
  const [newcomerClearScanCount, setNewcomerClearScanCount] = useState<1 | 2>(
    defaultAppSettings.newcomerClearScanCount
  );
  const [savedNewcomerClearScanCount, setSavedNewcomerClearScanCount] = useState<1 | 2>(
    defaultAppSettings.newcomerClearScanCount
  );
  const [settingsFeedback, setSettingsFeedback] = useState<Feedback | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [accountFeedback, setAccountFeedback] = useState<Feedback | null>(null);
  const [accountLoading, setAccountLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  const [resetKey, setResetKey] = useState("");
  const [resetFeedback, setResetFeedback] = useState<Feedback | null>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    const settings = loadAppSettings();
    setNewcomerClearScanCount(settings.newcomerClearScanCount);
    setSavedNewcomerClearScanCount(settings.newcomerClearScanCount);
  }, []);

  useEffect(() => {
    let active = true;

    const loadAccount = async () => {
      if (!hasSupabaseEnv) {
        if (active) {
          setAccountFeedback({ tone: "error", message: supabaseEnvIssue ?? "Missing Supabase configuration." });
          setAccountLoading(false);
        }
        return;
      }

      const { data, error } = await supabase.auth.getUser();

      if (!active) return;

      if (error || !data.user) {
        setAccountFeedback({
          tone: "error",
          message: error?.message ?? "No signed-in account was found."
        });
        setAccountLoading(false);
        return;
      }

      const provider =
        typeof data.user.app_metadata?.provider === "string"
          ? data.user.app_metadata.provider
          : null;

      setAccount({
        email: data.user.email ?? "No email on this account",
        id: data.user.id,
        lastSignInAt: data.user.last_sign_in_at ?? null,
        provider
      });
      setAccountFeedback(null);
      setAccountLoading(false);
    };

    void loadAccount();

    return () => {
      active = false;
    };
  }, []);

  const settingsDirty = newcomerClearScanCount !== savedNewcomerClearScanCount;

  const saveSettings = () => {
    setSavingSettings(true);
    setSettingsFeedback(null);

    try {
      saveAppSettings({ newcomerClearScanCount });
      setSavedNewcomerClearScanCount(newcomerClearScanCount);
      setSettingsFeedback({
        tone: "success",
        message: "Scan preferences saved. They will persist in this browser after a refresh."
      });
    } catch (error: unknown) {
      setSettingsFeedback({
        tone: "error",
        message: `Could not save settings: ${error instanceof Error ? error.message : "Unknown error."}`
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const restoreDefaultSettings = () => {
    setSavingSettings(true);
    setSettingsFeedback(null);

    try {
      saveAppSettings(defaultAppSettings);
      setNewcomerClearScanCount(defaultAppSettings.newcomerClearScanCount);
      setSavedNewcomerClearScanCount(defaultAppSettings.newcomerClearScanCount);
      setSettingsFeedback({ tone: "success", message: "Default scan preferences restored." });
    } catch (error: unknown) {
      setSettingsFeedback({
        tone: "error",
        message: `Could not restore defaults: ${error instanceof Error ? error.message : "Unknown error."}`
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSignOut = async () => {
    if (!hasSupabaseEnv || signingOut) return;

    setSigningOut(true);
    setAccountFeedback(null);

    const { error } = await supabase.auth.signOut();
    setSigningOut(false);

    if (error) {
      setAccountFeedback({ tone: "error", message: `Sign out failed: ${error.message}` });
      return;
    }

    router.replace("/login");
  };

  const canReset = resetKey.trim().toUpperCase() === "RESET";

  const runReset = async (mode: "attendance" | "all") => {
    if (!hasSupabaseEnv) {
      setResetFeedback({ tone: "error", message: supabaseEnvIssue ?? "Missing Supabase env values." });
      return;
    }

    if (!canReset) {
      setResetFeedback({ tone: "error", message: "Type RESET to unlock database reset." });
      return;
    }

    setResetting(true);
    setResetFeedback(null);

    try {
      const attendanceDelete = await supabase.from("attendance").delete().not("id", "is", null);
      if (attendanceDelete.error) throw attendanceDelete.error;

      if (mode === "all") {
        const eventsDelete = await supabase.from("events").delete().not("id", "is", null);
        if (eventsDelete.error) throw eventsDelete.error;

        const usersDelete = await supabase.from("users").delete().not("id", "is", null);
        if (usersDelete.error) throw usersDelete.error;
      }

      setResetFeedback({
        tone: "success",
        message:
          mode === "all"
            ? "Database reset complete: users, attendance, and events cleared."
            : "Attendance data cleared."
      });
      setResetKey("");
    } catch (error: unknown) {
      setResetFeedback({
        tone: "error",
        message: `Reset failed: ${error instanceof Error ? error.message : "Unknown reset error."}`
      });
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-6 reveal">
      <section className="card overflow-hidden bg-gradient-to-br from-[#f7fbf9] to-[#e9f1ee]">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="page-title font-[var(--font-heading)]">Settings</h1>
            <p className="page-subtitle">
              Review the signed-in account, configure scanning behaviour, and manage application data.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-[#9fc6b7] bg-[#e7f4ee] px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#245142]">
              {hasSupabaseEnv ? "Supabase configured" : "Setup required"}
            </span>
            <span className="rounded-full border border-[#afc4bc] bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#406357]">
              Saved in this browser
            </span>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <section className="analytics-panel">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-[var(--font-heading)] text-xl text-[#22332d]">Scan Preferences</h2>
              <p className="mt-1 text-sm text-[#5d7269]">
                Control how the scanner handles newcomer tags after attendance is recorded.
              </p>
            </div>
            <span className="rounded-full border border-[#b9cac3] bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#4f675e]">
              Attendance
            </span>
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <p className="text-sm font-semibold text-[#35564a]">Remove the newcomer tag after</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {[1, 2].map((count) => {
                  const selected = newcomerClearScanCount === count;
                  return (
                    <button
                      key={count}
                      type="button"
                      onClick={() => {
                        setNewcomerClearScanCount(count as 1 | 2);
                        setSettingsFeedback(null);
                      }}
                      className={`rounded-2xl border p-4 text-left transition ${
                        selected
                          ? "border-[#385b4f] bg-[#e8f3ef] shadow-[0_8px_20px_rgba(56,91,79,0.12)]"
                          : "border-[#c8d6d1] bg-white/80 hover:bg-[#f4f9f7]"
                      }`}
                      aria-pressed={selected}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[#22332d]">
                          {count} {count === 1 ? "scan" : "scans"}
                        </span>
                        {selected ? (
                          <span className="rounded-full bg-[#385b4f] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white">
                            Selected
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 block text-xs text-[#5d7269]">
                        {count === 1
                          ? "Clear the tag after the member's first recorded attendance."
                          : "Keep the tag until the member has two recorded attendances."}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn-primary"
                onClick={saveSettings}
                disabled={savingSettings || !settingsDirty}
              >
                {savingSettings ? "Saving..." : "Save Settings"}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={restoreDefaultSettings}
                disabled={savingSettings}
              >
                Restore Defaults
              </button>
              {settingsDirty ? (
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[#7a5a17]">
                  Unsaved changes
                </span>
              ) : null}
            </div>

            {settingsFeedback ? (
              <p className={feedbackClass(settingsFeedback.tone)} role="status">
                {settingsFeedback.message}
              </p>
            ) : null}

            <p className="text-xs text-[#5f756c]">
              This preference is stored in this browser only. It is read by the Scan page when the scanner loads.
            </p>
          </div>
        </section>

        <section className="analytics-panel">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-[var(--font-heading)] text-xl text-[#22332d]">Account</h2>
              <p className="mt-1 text-sm text-[#5d7269]">Current administrator session.</p>
            </div>
            <span className="rounded-full border border-[#b9cac3] bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#4f675e]">
              Security
            </span>
          </div>

          {accountLoading ? (
            <p className="mt-4 text-sm text-[#4f675e]">Loading account details...</p>
          ) : account ? (
            <dl className="mt-4 divide-y divide-[#d6e1dd] text-sm">
              <div className="py-3">
                <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7a8b84]">Email</dt>
                <dd className="mt-1 break-all font-semibold text-[#2f4d43]">{account.email}</dd>
              </div>
              <div className="py-3">
                <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7a8b84]">User ID</dt>
                <dd className="mt-1 break-all font-mono text-xs text-[#4f675e]">{account.id}</dd>
              </div>
              <div className="py-3">
                <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7a8b84]">Last sign-in</dt>
                <dd className="mt-1 font-semibold text-[#2f4d43]">{formatTimestamp(account.lastSignInAt)}</dd>
              </div>
              {account.provider ? (
                <div className="py-3">
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7a8b84]">Sign-in method</dt>
                  <dd className="mt-1 font-semibold capitalize text-[#2f4d43]">{account.provider}</dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <p className="mt-4 text-sm text-[#4f675e]">Account details are unavailable.</p>
          )}

          {accountFeedback ? (
            <p className={`${feedbackClass(accountFeedback.tone)} mt-3`} role="status">
              {accountFeedback.message}
            </p>
          ) : null}

          <button
            type="button"
            className="btn-ghost mt-4 w-full sm:w-auto"
            onClick={() => void handleSignOut()}
            disabled={!hasSupabaseEnv || signingOut}
          >
            {signingOut ? "Signing out..." : "Sign Out"}
          </button>
        </section>
      </div>

      <section className="analytics-panel border-[#d8c3c5] bg-[#fffafa]">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-[var(--font-heading)] text-xl text-[#5b3135]">Data Management</h2>
            <p className="mt-1 text-sm text-[#744147]">
              These actions permanently delete live data. They cannot be undone.
            </p>
          </div>
          <span className="rounded-full border border-[#d9b6ba] bg-[#fff3f4] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8a3f46]">
            Danger zone
          </span>
        </div>

        <div className="mt-4 space-y-3 rounded-2xl border border-[#e0b8bb] bg-[#fff7f7] p-4 text-[#5b3135]">
          <p className="text-sm font-semibold">Reset database data</p>
          <p className="text-xs text-[#744147]">
            Type <span className="font-semibold">RESET</span> to enable the reset buttons. Clearing attendance keeps
            members and events; a full reset removes users, attendance, and events.
          </p>
          <input
            type="text"
            value={resetKey}
            onChange={(event) => {
              setResetKey(event.target.value);
              setResetFeedback(null);
            }}
            className="field-input max-w-[220px]"
            placeholder="Type RESET"
            aria-label="Type RESET to unlock database reset"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-ghost"
              disabled={!canReset || resetting}
              onClick={() => void runReset("attendance")}
            >
              {resetting ? "Working..." : "Clear Attendance Only"}
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-full bg-[#b83f49] px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!canReset || resetting}
              onClick={() => void runReset("all")}
            >
              {resetting ? "Working..." : "Full Reset (Users + Attendance + Events)"}
            </button>
          </div>
          {resetFeedback ? (
            <p className={feedbackClass(resetFeedback.tone)} role="status">
              {resetFeedback.message}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
