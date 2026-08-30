import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const query = vi.fn();
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  return { query, release, connect };
});

vi.mock("pg", () => ({
  Pool: class {
    connect = mocks.connect;
  },
}));

vi.mock("redis", () => ({
  createClient: vi.fn(() => ({
    on: vi.fn(),
    connect: vi.fn(async () => undefined),
    del: vi.fn(),
    mGet: vi.fn(),
  })),
}));

import {
  getLeaderboard,
  getShanghaiDateString,
  isValidLeaderboardDate,
} from "./db";

describe("live leaderboard aggregation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({
      rows: [
        {
          rank: 1,
          user_id: "user-1",
          user_name: "Alice",
          request_count: "3",
        },
      ],
    });
  });

  it("uses the Shanghai calendar date at the UTC day boundary", () => {
    expect(getShanghaiDateString(new Date("2026-08-28T16:01:00.000Z"))).toBe(
      "2026-08-29"
    );
  });

  it.each(["2026-02-30", "2026-8-29", "not-a-date", "20260829"])(
    "rejects invalid date %s",
    (date) => {
      expect(isValidLeaderboardDate(date)).toBe(false);
    }
  );

  it("aggregates successful MCP tool calls directly instead of reading the snapshot table", async () => {
    await expect(getLeaderboard("2026-08-29")).resolves.toEqual([
      {
        rank: 1,
        user_id: "user-1",
        user_name: "Alice",
        request_count: "3",
      },
    ]);

    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("FROM request_logs rl");
    expect(sql).not.toContain("FROM leaderboard");
    expect(sql).toContain("rl.request_path LIKE '/mcp/tools/call/%'");
    expect(sql).not.toContain("rl.request_path =");
    expect(sql).toContain("rl.status_code = 200");
    expect(sql).toContain("AT TIME ZONE 'Asia/Shanghai'");
    expect(sql).toContain("ROW_NUMBER()");
    expect(params).toEqual(["2026-08-29"]);
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it("fails before opening a database connection when the date is invalid", async () => {
    await expect(getLeaderboard("2026-02-30")).rejects.toThrow(
      "leaderboard date must use YYYY-MM-DD"
    );
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});
