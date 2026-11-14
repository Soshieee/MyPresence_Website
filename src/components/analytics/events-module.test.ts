// Tests for the Sunday Service analytics gating (P8 requirement: Sunday
// analytics only appear in the Sunday Service view, never on event days).

import { describe, expect, it } from "vitest";
import { shouldShowSundayAnalytics } from "./events-module";

const event = (eventType: string | null) => ({ event_type: eventType });

describe("shouldShowSundayAnalytics", () => {
  it("shows the Sunday split in the Sunday view for a plain Sunday (no events)", () => {
    expect(shouldShowSundayAnalytics("sunday", [])).toBe(true);
  });

  it("shows the Sunday split when every event that day is a Sunday Service", () => {
    expect(shouldShowSundayAnalytics("sunday", [event("Sunday Service")])).toBe(true);
  });

  it("hides the Sunday split when the day includes a non-Sunday event", () => {
    // e.g. the 39th Anniversary (General) — event days never get Sunday analytics.
    expect(shouldShowSundayAnalytics("sunday", [event("General")])).toBe(false);
    expect(
      shouldShowSundayAnalytics("sunday", [event("Sunday Service"), event("Rooftop")])
    ).toBe(false);
  });

  it("hides the Sunday split when an event type is unknown", () => {
    expect(shouldShowSundayAnalytics("sunday", [event(null)])).toBe(false);
  });

  it("never shows the Sunday split outside the Sunday view", () => {
    expect(shouldShowSundayAnalytics("all", [event("Sunday Service")])).toBe(false);
    expect(shouldShowSundayAnalytics("special", [])).toBe(false);
  });
});
