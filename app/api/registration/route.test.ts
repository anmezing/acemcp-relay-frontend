import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isRegistrationDisabled: vi.fn(),
  countRegisteredUsers: vi.fn(),
  getRegistrationLimit: vi.fn(),
  isEmailVerificationConfigured: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isRegistrationDisabled: mocks.isRegistrationDisabled,
  countRegisteredUsers: mocks.countRegisteredUsers,
  getRegistrationLimit: mocks.getRegistrationLimit,
}));

vi.mock("@/lib/email-verification", () => ({
  isEmailVerificationConfigured: mocks.isEmailVerificationConfigured,
}));

import { GET } from "./route";

describe("registration status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isEmailVerificationConfigured.mockReturnValue(true);
  });

  it.each([
    [false, true],
    [true, false],
  ])("maps disabled=%s to enabled=%s", async (disabled, enabled) => {
    mocks.isRegistrationDisabled.mockResolvedValueOnce(disabled);
    mocks.countRegisteredUsers.mockResolvedValueOnce(0);
    mocks.getRegistrationLimit.mockResolvedValueOnce(null);
    const response = await GET();
    await expect(response.json()).resolves.toEqual({
      enabled,
      emailRegistrationEnabled: true,
      count: 0,
      limit: null,
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
  });

  it("fails email registration closed when SMTP is unavailable without closing OAuth registration", async () => {
    mocks.isRegistrationDisabled.mockResolvedValueOnce(false);
    mocks.countRegisteredUsers.mockResolvedValueOnce(2);
    mocks.getRegistrationLimit.mockResolvedValueOnce(1000);
    mocks.isEmailVerificationConfigured.mockReturnValueOnce(false);

    const response = await GET();
    await expect(response.json()).resolves.toEqual({
      enabled: true,
      emailRegistrationEnabled: false,
      count: 2,
      limit: 1000,
    });
  });
});
