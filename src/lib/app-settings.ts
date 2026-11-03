import type { AppSettings } from "@/types";

const STORAGE_KEY = "mypresence_settings_v1";

export const defaultAppSettings: AppSettings = {
  newcomerClearScanCount: 2
};

export function loadAppSettings(): AppSettings {
  if (typeof window === "undefined") return defaultAppSettings;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultAppSettings;

    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      newcomerClearScanCount:
        parsed.newcomerClearScanCount === 1 || parsed.newcomerClearScanCount === 2
          ? parsed.newcomerClearScanCount
          : defaultAppSettings.newcomerClearScanCount
    };
  } catch {
    return defaultAppSettings;
  }
}

export function saveAppSettings(settings: AppSettings) {
  if (typeof window === "undefined") {
    throw new Error("Settings can only be saved in the browser.");
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
