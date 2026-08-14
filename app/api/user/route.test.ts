import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listUserAccounts: vi.fn(),
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: mocks.getSession,
      listUserAccounts: mocks.listUserAccounts,
    },
  },
}));

import { GET } from "./route";

describe("user route authentication sources", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns persisted providers without inferring from profile fields", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: {
        id: "user-1",
        name: "Self registered",
        email: "self@example.com",
        image: null,
        username: null,
        trustLevel: 0,
        githubCreatedAt: null,
        createdAt: new Date("2026-08-14T00:00:00Z"),
      },
    });
    mocks.listUserAccounts.mockResolvedValueOnce([
      { providerId: "credential" },
      { providerId: "credential" },
    ]);

    const response = await GET();
    const payload = await response.json();

    expect(payload.authProviders).toEqual(["credential"]);
    expect(payload.email).toBe("self@example.com");
    expect(mocks.listUserAccounts).toHaveBeenCalledOnce();
  });

  it("does not query accounts for unauthenticated requests", async () => {
    mocks.getSession.mockResolvedValueOnce(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.listUserAccounts).not.toHaveBeenCalled();
  });
});
