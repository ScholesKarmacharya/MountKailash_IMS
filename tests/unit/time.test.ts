import { describe, expect, it } from "vitest";
import { nepalDateLabel, isOvernightDay } from "@/domain/business-days/time";
describe("Nepal calendar display, independent of business-day attribution", () => {
  it("crosses midnight at UTC 18:15", () => {
    expect(nepalDateLabel(new Date("2026-10-11T18:14:59Z"))).toBe("2026-10-11");
    expect(nepalDateLabel(new Date("2026-10-11T18:15:00Z"))).toBe("2026-10-12");
  });
  it("warns about yesterday's active business day without closing it", () => {
    const now = new Date("2026-10-11T18:15:00Z");
    expect(isOvernightDay("2026-10-11", now)).toBe(true);
    expect(isOvernightDay("2026-10-12", now)).toBe(false);
  });
});
