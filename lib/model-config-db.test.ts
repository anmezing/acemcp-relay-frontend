import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  initDB: vi.fn(async () => undefined),
  deleteModelConfigCache: vi.fn(async () => undefined),
  query: vi.fn(),
  release: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  default: {
    connect: vi.fn(async () => ({ query: mocks.query, release: mocks.release })),
  },
  initDB: mocks.initDB,
  deleteModelConfigCache: mocks.deleteModelConfigCache,
}));

vi.mock("@/lib/model-config-crypto", () => ({
  encryptModelConfig: vi.fn(() => "encrypted"),
}));

import {
  getUserModelConfigRow,
  resetUserModelConfig,
  saveUserModelConfig,
} from "./model-config-db";

describe("model config database initialization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({ rows: [] });
  });

  it("initializes the schema before reading a model config", async () => {
    await getUserModelConfigRow("user-1");
    expect(mocks.initDB).toHaveBeenCalledOnce();
    expect(mocks.initDB.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.query.mock.invocationCallOrder[0],
    );
  });

  it("initializes the schema before saving and invalidates the relay cache", async () => {
    await saveUserModelConfig("user-1", { rerank: {} } as never);
    expect(mocks.initDB).toHaveBeenCalledOnce();
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO user_model_configs"), [
      "user-1",
      "encrypted",
    ]);
    expect(mocks.deleteModelConfigCache).toHaveBeenCalledWith("user-1");
  });

  it("initializes the schema before resetting a model config", async () => {
    await resetUserModelConfig("user-1");
    expect(mocks.initDB).toHaveBeenCalledOnce();
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM user_model_configs"),
      ["user-1"],
    );
  });
});
