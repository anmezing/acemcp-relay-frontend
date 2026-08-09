import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const query = vi.fn();
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  const redisDel = vi.fn(async () => 1);
  return { query, release, connect, redisDel };
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
    del: mocks.redisDel,
  })),
}));

import { createApiKey, resetApiKey } from "./db";

describe("API credential transactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serializes reset under the credential lock and invalidates cache after commit", async () => {
    const oldRecord = { id: "old-id" };
    const newRecord = { id: "new-id", api_key: "ace_new" };
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT id FROM api_keys")) return { rows: [oldRecord] };
      if (sql.includes("UPDATE api_keys")) return { rows: [newRecord] };
      return { rows: [] };
    });

    await expect(resetApiKey("user-1")).resolves.toEqual(newRecord);

    const statements = mocks.query.mock.calls.map(([sql]) => String(sql));
    expect(statements[0]).toBe("BEGIN");
    expect(statements[1]).toContain("acemcp:user-credentials");
    expect(statements[2]).toContain("FOR UPDATE");
    expect(statements.at(-1)).toBe("COMMIT");
    expect(mocks.redisDel).toHaveBeenCalledWith("apikey:old-id");
    expect(mocks.redisDel.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.query.mock.invocationCallOrder.at(-1) ?? 0
    );
  });

  it("makes concurrent create idempotent under the credential lock", async () => {
    const existing = { id: "existing-id", api_key: "ace_existing" };
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT * FROM api_keys")) return { rows: [existing] };
      return { rows: [] };
    });

    await expect(createApiKey("user-1")).resolves.toEqual(existing);

    const statements = mocks.query.mock.calls.map(([sql]) => String(sql));
    expect(statements[1]).toContain("acemcp:user-credentials");
    expect(statements.some((sql) => sql.includes("INSERT INTO api_keys"))).toBe(false);
    expect(statements.at(-1)).toBe("COMMIT");
  });

  it("rolls back a failed reset without invalidating the old cache", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT id FROM api_keys")) return { rows: [{ id: "old-id" }] };
      if (sql.includes("UPDATE api_keys")) throw new Error("write failed");
      return { rows: [] };
    });

    await expect(resetApiKey("user-1")).rejects.toThrow("write failed");
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(mocks.redisDel).not.toHaveBeenCalled();
  });
});
