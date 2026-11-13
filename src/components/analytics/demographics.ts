// Shared demographic buckets/colors for the simplified analytics modules (P8).

export const AGE_BUCKETS = [
  { key: "kid", label: "Kid (0–13)", color: "#3b82f6", max: 13 },
  { key: "youth", label: "Youth (14–26)", color: "#f59e0b", max: 26 },
  { key: "young", label: "Young Professional (27–45)", color: "#8b5cf6", max: 45 },
  { key: "adult", label: "Adult (46+)", color: "#10b981", max: Number.POSITIVE_INFINITY }
] as const;

export type AgeBucketKey = (typeof AGE_BUCKETS)[number]["key"];

export function ageBucketFor(age: number | null | undefined): AgeBucketKey | null {
  if (age === null || age === undefined || !Number.isFinite(age)) return null;
  const bucket = AGE_BUCKETS.find((entry) => age <= entry.max);
  return bucket ? bucket.key : AGE_BUCKETS[AGE_BUCKETS.length - 1].key;
}

export const GENDER_COLORS: Record<string, string> = {
  Male: "#3b82f6",
  Female: "#ef4444",
  Other: "#f59e0b",
  Unknown: "#94a3b8"
};

export function genderColor(gender: string | null | undefined): string {
  return GENDER_COLORS[gender ?? "Unknown"] ?? "#94a3b8";
}
