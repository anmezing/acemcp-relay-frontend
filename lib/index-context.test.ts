import { describe, expect, it } from "vitest";
import { isCurrentIndexContext } from "@/lib/index-context";

describe("isCurrentIndexContext", () => {
  it("accepts responses for the currently selected context", () => {
    expect(isCurrentIndexContext(null, null)).toBe(true);
    expect(
      isCurrentIndexContext(
        { id: "org-a", name: "Current name" },
        { id: "org-a", name: "Requested name" },
      ),
    ).toBe(true);
  });

  it("rejects stale organization responses after switching to personal", () => {
    expect(isCurrentIndexContext(null, { id: "org-a", name: "Organization A" })).toBe(false);
  });

  it("rejects stale personal or organization responses after another selection", () => {
    const selected = { id: "org-b", name: "Organization B" };
    expect(isCurrentIndexContext(selected, null)).toBe(false);
    expect(isCurrentIndexContext(selected, { id: "org-a", name: "Organization A" })).toBe(false);
  });
});
