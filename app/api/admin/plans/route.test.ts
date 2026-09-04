import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
  listBillingPlans: vi.fn(),
  saveBillingPlan: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ requireAdminSession: mocks.requireAdminSession }));
vi.mock("@/lib/billing", () => ({
  listBillingPlans: mocks.listBillingPlans,
  saveBillingPlan: mocks.saveBillingPlan,
}));

import { POST } from "./route";

function request() {
  return new NextRequest("http://localhost/api/admin/plans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: "pro",
      name: "Pro",
      tier: "pro",
      priceFen: 100,
      durationDays: 30,
      dailyRequestLimit: 1000,
      dailyIndexBytesLimit: 1024,
      subaccountLimit: 1,
    }),
  });
}

describe("admin billing plan route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminSession.mockResolvedValue({ user: { id: "admin" } });
  });

  it("returns 400 only for known validation failures", async () => {
    mocks.saveBillingPlan.mockRejectedValue(new Error("INVALID_PLAN_CODE"));
    expect((await POST(request())).status).toBe(400);
  });

  it("returns 409 for a duplicate plan code", async () => {
    mocks.saveBillingPlan.mockRejectedValue(Object.assign(new Error("duplicate"), { code: "23505" }));
    expect((await POST(request())).status).toBe(409);
  });

  it("does not disguise database or internal failures as invalid input", async () => {
    mocks.saveBillingPlan.mockRejectedValue(new Error("connection reset"));
    const response = await POST(request());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "套餐保存失败" });
  });
});
