import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

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

import {
  createApiKey,
  deleteOrgMemberQuotaCache,
  deleteOrgQuotaCache,
  resetApiKey,
} from "./db";

describe("API credential transactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serializes reset under the credential lock and commits the replacement atomically", async () => {
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

  it("rolls back a failed reset", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT id FROM api_keys")) return { rows: [{ id: "old-id" }] };
      if (sql.includes("UPDATE api_keys")) throw new Error("write failed");
      return { rows: [] };
    });

    await expect(resetApiKey("user-1")).rejects.toThrow("write failed");
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it("stores the SHA-256 hex of the token as id on create", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT * FROM api_keys")) return { rows: [] };
      return { rows: [{}] };
    });

    await createApiKey("user-1");

    const insertCall = mocks.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO api_keys")
    );
    expect(insertCall).toBeDefined();
    const [, [id, , apiKey]] = insertCall as [string, [string, string, string]];
    expect(apiKey).toMatch(/^ace_[0-9a-f]{40}$/);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id).toBe(createHash("sha256").update(apiKey).digest("hex"));
  });

  it("stores the SHA-256 hex of the new token as id on reset", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT id FROM api_keys")) return { rows: [{ id: "old-id" }] };
      return { rows: [{}] };
    });

    await resetApiKey("user-1");

    const updateCall = mocks.query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE api_keys")
    );
    expect(updateCall).toBeDefined();
    const [, [, id, apiKey]] = updateCall as [string, [string, string, string]];
    expect(apiKey).toMatch(/^ace_[0-9a-f]{40}$/);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id).toBe(createHash("sha256").update(apiKey).digest("hex"));
  });

  it("uses the relay contract key for organization member quota invalidation", async () => {
    await deleteOrgMemberQuotaCache("org-1", "user-1");
    expect(mocks.redisDel).toHaveBeenCalledWith(
      "quota:limit:member:4620fd3c76d86783329c9d16a2f45531b11dd545776ca278e57ecc43888bf922"
    );
  });

  it("uses the relay contract key for organization quota invalidation", async () => {
    await deleteOrgQuotaCache("org-1");
    expect(mocks.redisDel).toHaveBeenCalledWith("quota:limit:orgq:org-1");
  });
});
