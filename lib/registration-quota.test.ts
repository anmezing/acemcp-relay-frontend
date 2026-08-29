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
  getRegistrationRemainingSlots,
  initRegistrationGate,
  isRegistrationAtCapacity,
  setRegistrationRemainingSlots,
} from "./db";

describe("registration remaining-slot gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("to_regclass")) return { rows: [{ exists: true }] };
      if (sql.includes("SELECT value FROM system_settings") && params?.[0] === "registration_remaining_slots") {
        return { rows: [{ value: "6" }] };
      }
      return { rows: [] };
    });
  });

  it("migrates the old total ceiling and installs an atomic decrement trigger", async () => {
    await initRegistrationGate();

    const calls = mocks.query.mock.calls.map(([sql, params]) => ({
      sql: String(sql),
      params,
    }));
    const migration = calls.find(({ sql }) => sql.includes("WITH legacy AS"));
    expect(migration?.sql).toContain('COUNT(*)::numeric AS registered_users FROM "user"');
    expect(migration?.params).toEqual([
      "registration_remaining_slots",
      "registration_max_users",
    ]);

    const triggerFunction = calls.find(({ sql }) => sql.includes("CREATE OR REPLACE FUNCTION enforce_registration_gate"))?.sql ?? "";
    expect(triggerFunction).toContain("FOR UPDATE");
    expect(triggerFunction).toContain("remaining_value::bigint - 1");
    expect(triggerFunction).toContain("REGISTRATION_LIMIT_REACHED");
    expect(calls.some(({ sql }) => sql.includes('BEFORE INSERT ON "user"'))).toBe(true);

    mocks.query.mockClear();
    await expect(getRegistrationRemainingSlots()).resolves.toBe(6);
    await expect(isRegistrationAtCapacity()).resolves.toBe(false);
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes('COUNT(*)::int AS count FROM "user"'))).toBe(false);

    mocks.query.mockClear();
    await setRegistrationRemainingSlots(6);
    const slotWrite = mocks.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO system_settings (key, value)")
    );
    expect(slotWrite?.[1]).toEqual(["registration_remaining_slots", "6"]);
  });
});
