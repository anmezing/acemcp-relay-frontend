import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
  initRegistrationGate: vi.fn(),
  getSystemSetting: vi.fn(),
  setSystemSetting: vi.fn(),
  getRegistrationRemainingSlots: vi.fn(),
  setRegistrationRemainingSlots: vi.fn(),
  countRegisteredUsers: vi.fn(),
  countUserModelConfigs: vi.fn(),
  modelConfigEnabled: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ requireAdminSession: mocks.requireAdminSession }));
vi.mock("@/lib/db", () => ({
  initRegistrationGate: mocks.initRegistrationGate,
  getSystemSetting: mocks.getSystemSetting,
  setSystemSetting: mocks.setSystemSetting,
  getRegistrationRemainingSlots: mocks.getRegistrationRemainingSlots,
  setRegistrationRemainingSlots: mocks.setRegistrationRemainingSlots,
  countRegisteredUsers: mocks.countRegisteredUsers,
}));
vi.mock("@/lib/model-config-db", () => ({
  countUserModelConfigs: mocks.countUserModelConfigs,
}));
vi.mock("@/lib/model-config-crypto", () => ({
  modelConfigEnabled: mocks.modelConfigEnabled,
}));

import { GET, POST } from "./route";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/admin/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("admin registration settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminSession.mockResolvedValue({ user: { id: "admin" } });
    mocks.initRegistrationGate.mockResolvedValue(undefined);
    mocks.getSystemSetting.mockResolvedValue("true");
    mocks.getRegistrationRemainingSlots.mockResolvedValue(6);
    mocks.countRegisteredUsers.mockResolvedValue(300);
    mocks.modelConfigEnabled.mockReturnValue(false);
    mocks.countUserModelConfigs.mockResolvedValue(0);
  });

  it("returns total users separately from remaining new-registration slots", async () => {
    const response = await GET();
    await expect(response.json()).resolves.toMatchObject({
      registrationEnabled: true,
      registrationSlots: 6,
      registrationLimit: 6,
      registeredUsers: 300,
    });
  });

  it("saves the entered number directly as remaining slots", async () => {
    const response = await POST(request({ registrationSlots: 6 }));
    expect(response.status).toBe(200);
    expect(mocks.setRegistrationRemainingSlots).toHaveBeenCalledWith(6);
    expect(mocks.countRegisteredUsers).not.toHaveBeenCalled();
  });

  it("accepts zero as an exhausted quota and null as unlimited", async () => {
    expect((await POST(request({ registrationSlots: 0 }))).status).toBe(200);
    expect(mocks.setRegistrationRemainingSlots).toHaveBeenLastCalledWith(0);

    expect((await POST(request({ registrationSlots: null }))).status).toBe(200);
    expect(mocks.setRegistrationRemainingSlots).toHaveBeenLastCalledWith(null);
  });

  it("treats a non-object body as a missing setting", async () => {
    const response = await POST(request(null));
    expect(response.status).toBe(400);
    expect(mocks.setSystemSetting).not.toHaveBeenCalled();
    expect(mocks.setRegistrationRemainingSlots).not.toHaveBeenCalled();
  });

  it("rejects invalid slots before applying any setting", async () => {
    expect((await POST(request({ registrationEnabled: false, registrationSlots: -1 }))).status).toBe(400);
    expect((await POST(request({ registrationSlots: 1.5 }))).status).toBe(400);
    expect(mocks.setSystemSetting).not.toHaveBeenCalled();
    expect(mocks.setRegistrationRemainingSlots).not.toHaveBeenCalled();
  });
});
