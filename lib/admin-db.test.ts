import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const query = vi.fn();
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  return { query, release, connect };
});

vi.mock("@/lib/db", () => ({
  default: { connect: mocks.connect },
  deleteBannedCache: vi.fn(),
  deleteQuotaLimitCache: vi.fn(),
  resetApiKey: vi.fn(),
}));

import { listUsersWithStats } from "./admin-db";

describe("admin user authentication providers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selects every Better Auth provider linked to a user", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [{
        id: "user-1",
        email: "user@example.com",
        name: "User",
        created_at: new Date("2026-08-12T00:00:00Z"),
        request_count: "2",
        last_request_at: null,
        banned: false,
        tier: "free",
        auth_providers: ["github", "linuxdo"],
      }],
    });

    const users = await listUsersWithStats();
    const sql = String(mocks.query.mock.calls[0]?.[0]);
    const selectClause = sql.slice(0, sql.indexOf('FROM "user"'));

    expect(selectClause).toContain("a.auth_providers");
    expect(sql).toContain("FROM account");
    expect(users[0]).toMatchObject({
      request_count: 2,
      auth_providers: ["github", "linuxdo"],
    });
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("returns an empty provider list when no account binding exists", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [{ id: "user-1", request_count: "0", auth_providers: null }],
    });

    await expect(listUsersWithStats()).resolves.toEqual([
      { id: "user-1", request_count: 0, auth_providers: [] },
    ]);
  });
});
