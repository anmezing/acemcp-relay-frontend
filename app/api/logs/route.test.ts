import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("@/lib/db", () => ({
  countRequestLogs: vi.fn(),
  getRequestLogs: vi.fn(),
  getRequestLogStats: vi.fn(),
}));

import { auth } from "@/lib/auth";
import {
  countRequestLogs,
  getRequestLogs,
  getRequestLogStats,
} from "@/lib/db";
import { GET } from "./route";

const getSession = vi.mocked(auth.api.getSession);
const countLogs = vi.mocked(countRequestLogs);
const listLogs = vi.mocked(getRequestLogs);
const getStats = vi.mocked(getRequestLogStats);

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: "user-1" } } as Awaited<ReturnType<typeof auth.api.getSession>>);
  listLogs.mockResolvedValue([]);
});

describe("GET /api/logs", () => {
  it("always returns exact totals and clamps a page beyond the last page", async () => {
    countLogs.mockResolvedValue(35);
    const response = await GET(new Request("http://localhost/api/logs?page=999&limit=20"));

    expect(response.status).toBe(200);
    expect(listLogs).toHaveBeenCalledWith("user-1", 20, 20);
    expect(getStats).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      pagination: { page: 2, limit: 20, total: 35, totalPages: 2 },
    });
  });

  it("validates pagination and returns dashboard stats on the first page", async () => {
    getStats.mockResolvedValue({
      successCount: 30,
      failedCount: 5,
      totalCount: 35,
      contextEngineCount: 4,
    });
    const response = await GET(
      new Request("http://localhost/api/logs?page=-2&limit=9999&withStats=true")
    );

    expect(listLogs).toHaveBeenCalledWith("user-1", 100, 0);
    expect(countLogs).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      stats: { successCount: 30, failedCount: 5, totalCount: 35, contextEngineCount: 4 },
      pagination: { page: 1, limit: 100, total: 35, totalPages: 1 },
    });
  });
});
