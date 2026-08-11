import { describe, expect, it } from "vitest";
import { loginUrl, sanitizeCallbackUrl } from "./auth-redirect";

describe("auth redirects", () => {
  it("keeps only same-origin relative callback paths", () => {
    expect(sanitizeCallbackUrl("/accept-invitation/invite-1")).toBe(
      "/accept-invitation/invite-1"
    );
    for (const hostile of ["https://evil.test", "//evil.test", "/\\evil.test", null]) {
      expect(sanitizeCallbackUrl(hostile)).toBe("/");
    }
  });

  it("encodes the invitation path into the login callback", () => {
    expect(loginUrl("/accept-invitation/invite-1")).toBe(
      "/login?callbackUrl=%2Faccept-invitation%2Finvite-1"
    );
  });
});
