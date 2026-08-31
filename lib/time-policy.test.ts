import { describe, expect, it } from "vitest";
import { nextZonedDayBoundary, zonedDayKey } from "@/lib/time-policy";

describe("time policy", () => {
  it("resolves the next configured calendar boundary without a fixed UTC offset", () => {
    const now = new Date("2026-08-15T12:00:00.000Z");
    expect(zonedDayKey(now, "Asia/Shanghai")).toBe("20260815");
    expect(nextZonedDayBoundary(now, "Asia/Shanghai").toISOString()).toBe(
      "2026-08-15T16:00:00.000Z",
    );
    expect(nextZonedDayBoundary(now, "UTC").toISOString()).toBe(
      "2026-08-16T00:00:00.000Z",
    );
  });

  it("honors daylight-saving transitions", () => {
    const now = new Date("2026-03-08T06:30:00.000Z");
    expect(nextZonedDayBoundary(now, "America/New_York").toISOString()).toBe(
      "2026-03-09T04:00:00.000Z",
    );
  });
});
