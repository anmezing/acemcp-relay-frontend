import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isRegistrationDisabled: vi.fn(),
  countRegisteredUsers: vi.fn(),
  getRegistrationLimit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isRegistrationDisabled: mocks.isRegistrationDisabled,
  countRegisteredUsers: mocks.countRegisteredUsers,
  getRegistrationLimit: mocks.getRegistrationLimit,
}));

import { GET } from "./route";

describe("registration status route", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    [false, true],
    [true, false],
  ])("maps disabled=%s to enabled=%s", async (disabled, enabled) => {
    mocks.isRegistrationDisabled.mockResolvedValueOnce(disabled);
    mocks.countRegisteredUsers.mockResolvedValueOnce(0);
    mocks.getRegistrationLimit.mockResolvedValueOnce(null);
    const response = await GET();
    await expect(response.json()).resolves.toEqual({ enabled, count: 0, limit: null });
  });
});
