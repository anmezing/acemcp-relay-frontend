import { beforeEach, describe, expect, it, vi } from "vitest";

// 冗余同步触发点覆盖表（见 org-sync.ts 头注释）：每个组织状态转换
// 必须落到 api_keys 组织密钥的正确操作，且角色映射符合契约
// （org_role 只有 'owner' | 'member' 两档）。
vi.mock("@/lib/org-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/org-db")>();
  return {
    ...actual,
    ensureOrgApiKey: vi.fn(async () => ({})),
    deleteOrgApiKey: vi.fn(async () => undefined),
    deleteAllOrgApiKeys: vi.fn(async () => undefined),
  };
});

import {
  deleteAllOrgApiKeys,
  deleteOrgApiKey,
  ensureOrgApiKey,
  toOrgRole,
} from "@/lib/org-db";
import {
  onMemberAdded,
  onMemberLeft,
  onMemberRemoved,
  onMemberRoleUpdated,
  onOrganizationCreated,
  onOrganizationDeleted,
} from "@/lib/org-sync";

const ensureMock = vi.mocked(ensureOrgApiKey);
const deleteMock = vi.mocked(deleteOrgApiKey);
const deleteAllMock = vi.mocked(deleteAllOrgApiKeys);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("toOrgRole（better-auth 角色 → 契约 org_role）", () => {
  it("owner 及含 owner 的复合角色映射为 owner", () => {
    expect(toOrgRole("owner")).toBe("owner");
    expect(toOrgRole("owner,member")).toBe("owner");
    expect(toOrgRole("admin, owner")).toBe("owner");
  });

  it("member/admin/未知/空一律映射为 member（fail-closed，不升权）", () => {
    expect(toOrgRole("member")).toBe("member");
    expect(toOrgRole("admin")).toBe("member");
    expect(toOrgRole("something-else")).toBe("member");
    expect(toOrgRole("")).toBe("member");
    expect(toOrgRole(null)).toBe("member");
    expect(toOrgRole(undefined)).toBe("member");
  });
});

describe("组织状态转换 → api_keys 冗余同步", () => {
  it("创建组织：为创建者发 owner 组织密钥", async () => {
    await onOrganizationCreated({
      organization: { id: "org-1" },
      member: { userId: "u1", organizationId: "org-1", role: "owner" },
    });
    expect(ensureMock).toHaveBeenCalledWith("u1", "org-1", "owner");
  });

  it("接受邀请 / 直接加成员：发 member 组织密钥", async () => {
    await onMemberAdded({
      member: { userId: "u2", organizationId: "org-1", role: "member" },
    });
    expect(ensureMock).toHaveBeenCalledWith("u2", "org-1", "member");
  });

  it("被移出组织：删除该成员的组织密钥", async () => {
    await onMemberRemoved({
      member: { userId: "u2", organizationId: "org-1", role: "member" },
    });
    expect(deleteMock).toHaveBeenCalledWith("u2", "org-1");
  });

  it("主动退出组织（leave 兜底钩子）：删除组织密钥", async () => {
    await onMemberLeft("u2", "org-1");
    expect(deleteMock).toHaveBeenCalledWith("u2", "org-1");
  });

  it("角色变更 / owner 转让：同步组织密钥 org_role", async () => {
    await onMemberRoleUpdated({
      member: { userId: "u2", organizationId: "org-1", role: "owner" },
    });
    expect(ensureMock).toHaveBeenCalledWith("u2", "org-1", "owner");

    await onMemberRoleUpdated({
      member: { userId: "u1", organizationId: "org-1", role: "member" },
    });
    expect(ensureMock).toHaveBeenCalledWith("u1", "org-1", "member");
  });

  it("删除组织：吊销全组织密钥", async () => {
    await onOrganizationDeleted({ organization: { id: "org-1" } });
    expect(deleteAllMock).toHaveBeenCalledWith("org-1");
  });

  it("同步失败不伪装成可回滚事务，交给外键与读取对账恢复", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    ensureMock.mockRejectedValueOnce(new Error("db down"));
    await expect(
      onMemberAdded({ member: { userId: "u2", organizationId: "org-1", role: "member" } })
    ).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(
      "Organization credential sync failed (member-added):",
      expect.any(Error)
    );
    consoleError.mockRestore();
  });
});
