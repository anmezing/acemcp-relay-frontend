import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isRegistrationDisabled: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isRegistrationDisabled: mocks.isRegistrationDisabled,
}));

import { GET } from "./route";

describe("registration status route", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    [false, true],
    [true, false],
  ])("maps disabled=%s to enabled=%s", async (disabled, enabled) => {
    mocks.isRegistrationDisabled.mockResolvedValueOnce(disabled);
    const response = await GET();
    await expect(response.json()).resolves.toEqual({ enabled });
  });
});
