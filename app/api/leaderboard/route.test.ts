import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getLeaderboard: vi.fn(),
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db", () => ({
  getLeaderboard: mocks.getLeaderboard,
  getApplicationDateString: vi.fn(() => "2026-08-29"),
  isValidLeaderboardDate: vi.fn(
    (value: string) => value === "2026-08-29" || value === "2026-08-28"
  ),
}));

import { GET } from "./route";

describe("leaderboard route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.getLeaderboard.mockResolvedValue([
      {
        rank: 1,
        user_id: "user-1",
        user_name: "Alice",
        request_count: "4",
      },
    ]);
  });

  it("returns a live, non-cacheable ranking for the requested date", async () => {
    const response = await GET(
      new Request("http://localhost/api/leaderboard?date=2026-08-29")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      date: "2026-08-29",
      entries: [
        {
          rank: 1,
          userName: "Al**e",
          requestCount: 4,
          isCurrentUser: true,
        },
      ],
    });
    expect(mocks.getLeaderboard).toHaveBeenCalledWith("2026-08-29");
  });

  it("rejects an invalid date without querying leaderboard data", async () => {
    const response = await GET(
      new Request("http://localhost/api/leaderboard?date=2026-02-30")
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.getLeaderboard).not.toHaveBeenCalled();
  });

  it("requires a signed-in user", async () => {
    mocks.getSession.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/leaderboard?date=2026-08-29")
    );

    expect(response.status).toBe(401);
    expect(mocks.getLeaderboard).not.toHaveBeenCalled();
  });
});
