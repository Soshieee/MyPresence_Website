// Tests for the feedback factor ratings calculation (P4/P8).
// The regression case: PostgREST returns count() aggregates (int8) as JSON
// strings, so a strict typeof-number check zeroed every per-factor rating in
// the analytics module even though the data was there.

import { describe, expect, it } from "vitest";
import {
  FEEDBACK_CATEGORIES,
  computeFeedbackStats,
  feedbackCategoryAverage,
  feedbackCategoryResponses,
  summaryNumber,
  type EventFeedbackRow,
  type EventFeedbackSummary
} from "./event-feedback";

function makeRow(overrides: Partial<EventFeedbackRow>): EventFeedbackRow {
  return {
    id: "row-1",
    event_id: "event-1",
    user_id: "user-1",
    overall_rating: 4,
    comment: null,
    author_display_name: null,
    created_at: "2025-10-05T10:00:00Z",
    ...overrides
  };
}

describe("summaryNumber", () => {
  it("reads numbers and numeric strings (PostgREST int8 shape)", () => {
    expect(summaryNumber(30)).toBe(30);
    expect(summaryNumber("30")).toBe(30);
    expect(summaryNumber(" 4.13 ")).toBeCloseTo(4.13);
  });

  it("returns null for missing or unusable values", () => {
    expect(summaryNumber(undefined)).toBeNull();
    expect(summaryNumber(null)).toBeNull();
    expect(summaryNumber("")).toBeNull();
    expect(summaryNumber("   ")).toBeNull();
    expect(summaryNumber("soon")).toBeNull();
  });
});

describe("feedbackCategoryAverage / feedbackCategoryResponses", () => {
  it("reads per-factor averages as numbers or numeric strings", () => {
    const summary = {
      event_id: "event-1",
      total_responses: "30",
      avg_food_rating: 4.13,
      avg_venue_rating: "3.50"
    } as unknown as EventFeedbackSummary;

    expect(feedbackCategoryAverage(summary, "food_rating")).toBeCloseTo(4.13);
    expect(feedbackCategoryAverage(summary, "venue_rating")).toBeCloseTo(3.5);
    expect(feedbackCategoryAverage(summary, "music_rating")).toBeNull();
    expect(feedbackCategoryAverage(undefined, "food_rating")).toBeNull();
  });

  it("reads per-factor response counts and reports unknown (not a false zero)", () => {
    const summary = {
      event_id: "event-1",
      food_responses: "24",
      venue_responses: 18
    } as unknown as EventFeedbackSummary;

    expect(feedbackCategoryResponses(summary, "food_rating")).toBe(24);
    expect(feedbackCategoryResponses(summary, "venue_rating")).toBe(18);
    // Column missing (summary view predates the counts patch) → unknown, not 0.
    expect(feedbackCategoryResponses(summary, "music_rating")).toBeNull();
  });
});

describe("computeFeedbackStats — per-factor ratings from raw rows", () => {
  it("averages each factor excluding N/A (null) ratings and counts real responses", () => {
    const rows = [
      makeRow({ id: "a", overall_rating: 5, food_rating: 4, venue_rating: null, music_rating: 5 }),
      makeRow({ id: "b", overall_rating: 4, food_rating: 5, venue_rating: 2, music_rating: null }),
      makeRow({ id: "c", overall_rating: 3, food_rating: 3, venue_rating: 4, music_rating: 4 })
    ];

    const stats = computeFeedbackStats(rows);

    const food = stats.categories.find((category) => category.key === "food_rating");
    expect(food?.count).toBe(3);
    expect(food?.avg).toBeCloseTo(4);

    const venue = stats.categories.find((category) => category.key === "venue_rating");
    expect(venue?.count).toBe(2);
    expect(venue?.avg).toBeCloseTo(3);

    const music = stats.categories.find((category) => category.key === "music_rating");
    expect(music?.count).toBe(2);
    expect(music?.avg).toBeCloseTo(4.5);

    expect(stats.total).toBe(3);
    expect(stats.overallAvg).toBeCloseTo(4);
  });

  it("rounds averages to two decimals", () => {
    const rows = [
      makeRow({ id: "a", food_rating: 1 }),
      makeRow({ id: "b", food_rating: 2 })
    ];
    const stats = computeFeedbackStats(rows);
    expect(stats.categories.find((category) => category.key === "food_rating")?.avg).toBe(1.5);
  });

  it("keeps every collected factor in order", () => {
    const stats = computeFeedbackStats([]);
    expect(stats.categories.map((category) => category.key)).toEqual(
      FEEDBACK_CATEGORIES.map((category) => category.key)
    );
  });
});

describe("computeFeedbackStats — summary view fallback", () => {
  it("uses summary averages and string counts when raw rows are unreadable", () => {
    // Exact shape that used to break: count() as int8 strings, avg() as numbers.
    const summary = {
      event_id: "event-1",
      total_responses: "30",
      avg_overall_rating: 3.2,
      avg_food_rating: 4.13,
      food_responses: "24",
      venue_responses: "18"
    } as unknown as EventFeedbackSummary;

    const stats = computeFeedbackStats([], summary);

    expect(stats.total).toBe(30);
    expect(stats.overallAvg).toBeCloseTo(3.2);

    const food = stats.categories.find((category) => category.key === "food_rating");
    expect(food?.avg).toBeCloseTo(4.13);
    expect(food?.count).toBe(24);

    const venue = stats.categories.find((category) => category.key === "venue_rating");
    expect(venue?.avg).toBeNull();
    expect(venue?.count).toBe(18);
  });

  it("still reports an average when its count column is missing", () => {
    const summary = {
      event_id: "event-1",
      total_responses: "10",
      avg_music_rating: "3.5"
    } as unknown as EventFeedbackSummary;

    const stats = computeFeedbackStats([], summary);
    const music = stats.categories.find((category) => category.key === "music_rating");
    expect(music?.avg).toBeCloseTo(3.5);
    expect(music?.count).toBe(0);
  });
});

describe("computeFeedbackStats — empty states", () => {
  it("returns null averages and zero counts when there is no data at all", () => {
    const stats = computeFeedbackStats([]);

    expect(stats.total).toBe(0);
    expect(stats.overallAvg).toBeNull();
    for (const category of stats.categories) {
      expect(category.avg).toBeNull();
      expect(category.count).toBe(0);
    }
  });

  it("ignores out-of-range factor values instead of averaging them", () => {
    const rows = [makeRow({ id: "a", food_rating: 9 as unknown as number })];
    const stats = computeFeedbackStats(rows);
    const food = stats.categories.find((category) => category.key === "food_rating");
    expect(food?.count).toBe(0);
    expect(food?.avg).toBeNull();
  });
});
