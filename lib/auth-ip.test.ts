import { describe, expect, it } from "vitest";
import { getIp } from "better-auth/api";
import { authIpAddressOptions } from "@/lib/auth-ip";

describe("authIpAddressOptions", () => {
  it.each([undefined, "", " , "])(
    "does not trust forwarded addresses without an explicit proxy list (%s)",
    (value) => {
      expect(authIpAddressOptions(value)).toEqual({ ipAddressHeaders: [] });
    },
  );

  it("enables X-Forwarded-For only for the normalized configured proxy chain", () => {
    expect(authIpAddressOptions(" 127.0.0.1/32, 10.0.0.0/8,127.0.0.1/32 ")).toEqual({
      ipAddressHeaders: ["x-forwarded-for"],
      trustedProxies: ["127.0.0.1/32", "10.0.0.0/8"],
    });
  });

  it("rejects invalid proxy entries instead of falling back to an unsafe single header", () => {
    expect(() => authIpAddressOptions("127.0.0.1/33")).toThrow(
      "BETTER_AUTH_TRUSTED_PROXIES contains invalid IP/CIDR entries",
    );
    expect(() => authIpAddressOptions("not-a-proxy")).toThrow(
      "BETTER_AUTH_TRUSTED_PROXIES contains invalid IP/CIDR entries",
    );
  });

  it("makes Better Auth ignore a caller-supplied X-Forwarded-For when unconfigured", () => {
    const spoofed = "198.51.100.27";
    const request = new Request("https://lcebot.com/api/auth/sign-in", {
      headers: { "x-forwarded-for": spoofed },
    });
    const options = {
      advanced: { ipAddress: authIpAddressOptions() },
    } as Parameters<typeof getIp>[1];

    expect(getIp(request, options)).not.toBe(spoofed);
  });
});
