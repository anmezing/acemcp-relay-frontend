import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  initRegistrationGate: vi.fn(),
  isRegistrationDisabled: vi.fn(),
  countRegisteredUsers: vi.fn(),
  getRegistrationRemainingSlots: vi.fn(),
  isEmailVerificationConfigured: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  initRegistrationGate: mocks.initRegistrationGate,
  isRegistrationDisabled: mocks.isRegistrationDisabled,
  countRegisteredUsers: mocks.countRegisteredUsers,
  getRegistrationRemainingSlots: mocks.getRegistrationRemainingSlots,
}));

vi.mock("@/lib/email-verification", () => ({
  isEmailVerificationConfigured: mocks.isEmailVerificationConfigured,
}));

import { GET } from "./route";

describe("registration status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.initRegistrationGate.mockResolvedValue(undefined);
    mocks.isEmailVerificationConfigured.mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    [false, true],
    [true, false],
  ])("maps disabled=%s to enabled=%s when slots are unlimited", async (disabled, enabled) => {
    mocks.isRegistrationDisabled.mockResolvedValueOnce(disabled);
    mocks.countRegisteredUsers.mockResolvedValueOnce(0);
    mocks.getRegistrationRemainingSlots.mockResolvedValueOnce(null);
    const response = await GET();
    await expect(response.json()).resolves.toEqual({
      enabled,
      emailRegistrationEnabled: true,
      passwordPolicy: { minLength: 8, maxLength: 128 },
      count: 0,
      remainingSlots: null,
      limit: null,
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
  });

  it("does not subtract existing users from newly opened slots", async () => {
    mocks.isRegistrationDisabled.mockResolvedValueOnce(false);
    mocks.countRegisteredUsers.mockResolvedValueOnce(300);
    mocks.getRegistrationRemainingSlots.mockResolvedValueOnce(6);

    const response = await GET();
    await expect(response.json()).resolves.toEqual({
      enabled: true,
      emailRegistrationEnabled: true,
      passwordPolicy: { minLength: 8, maxLength: 128 },
      count: 300,
      remainingSlots: 6,
      limit: 6,
    });
  });

  it("returns the configured password policy instead of browser-owned limits", async () => {
    vi.stubEnv("AUTH_MIN_PASSWORD_LENGTH", "12");
    vi.stubEnv("AUTH_MAX_PASSWORD_LENGTH", "64");
    mocks.isRegistrationDisabled.mockResolvedValueOnce(false);
    mocks.countRegisteredUsers.mockResolvedValueOnce(0);
    mocks.getRegistrationRemainingSlots.mockResolvedValueOnce(null);

    const response = await GET();
    await expect(response.json()).resolves.toMatchObject({
      passwordPolicy: { minLength: 12, maxLength: 64 },
    });
  });

  it("closes new registration only when remaining slots reach zero", async () => {
    mocks.isRegistrationDisabled.mockResolvedValueOnce(false);
    mocks.countRegisteredUsers.mockResolvedValueOnce(3);
    mocks.getRegistrationRemainingSlots.mockResolvedValueOnce(0);

    const response = await GET();
    await expect(response.json()).resolves.toMatchObject({
      enabled: false,
      count: 3,
      remainingSlots: 0,
    });
  });

  it("fails email registration closed when SMTP is unavailable without closing OAuth registration", async () => {
    mocks.isRegistrationDisabled.mockResolvedValueOnce(false);
    mocks.countRegisteredUsers.mockResolvedValueOnce(2);
    mocks.getRegistrationRemainingSlots.mockResolvedValueOnce(1000);
    mocks.isEmailVerificationConfigured.mockReturnValueOnce(false);

    const response = await GET();
    await expect(response.json()).resolves.toEqual({
      enabled: true,
      emailRegistrationEnabled: false,
      passwordPolicy: { minLength: 8, maxLength: 128 },
      count: 2,
      remainingSlots: 1000,
      limit: 1000,
    });
  });
});
