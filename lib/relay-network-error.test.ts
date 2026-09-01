import { describe, expect, it } from "vitest";
import { isRelayConnectionError } from "./relay-network-error";

describe("relay network errors", () => {
  it("recognizes Docker DNS and connection failures", () => {
    const dnsError = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ENOTFOUND", hostname: "relay" },
    });
    expect(isRelayConnectionError(dnsError)).toBe(true);
    expect(isRelayConnectionError({ cause: { code: "ECONNREFUSED" } })).toBe(true);
  });

  it("does not hide unrelated application failures", () => {
    expect(isRelayConnectionError(new Error("database unavailable"))).toBe(false);
  });
});
