import {
  deleteAllOrgApiKeys,
  deleteOrgApiKey,
  ensureOrgApiKey,
  toOrgRole,
} from "@/lib/org-db";

// 冗余同步：把 better-auth organization 事件落到 api_keys 组织密钥上。
// 触发点覆盖表（relay 契约：tenant := key.org_id ?? user_id）：
// - 创建组织            → afterCreateOrganization → 为创建者发 owner 组织密钥
// - 接受邀请            → afterAcceptInvitation   → 为受邀者发 member/owner 组织密钥
// - 直接加成员(addMember)→ afterAddMember          → 同上（与 accept 双触发时幂等复用）
// - 移出成员            → afterRemoveMember       → 删除该成员的组织密钥
// - 成员退出(leave)     → better-auth 1.6.23 的 /organization/leave 不走 member
//                        hooks，由 auth.ts 全局 after hook 调 onMemberLeft 兜底
// - 角色变更 / owner 转让→ afterUpdateMemberRole   → 更新组织密钥 org_role
// - 删除组织            → afterDeleteOrganization → 吊销全部组织密钥 + 清 org_quotas
//
// hooks 在 Better Auth 主变更提交后运行，不能提供跨事务回滚。同步失败只记录：
// 删除由数据库外键兜底，Relay 鉴权以 member 表为准，创建/角色冗余由密钥列表
// 的 reconcileUserOrgApiKeys 幂等修复。

interface MemberLike {
  userId: string;
  organizationId: string;
  role: string;
}

async function bestEffortOrgSync(label: string, action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error(`Organization credential sync failed (${label}):`, error);
  }
}

export async function onOrganizationCreated(data: {
  organization: { id: string };
  member: MemberLike;
}): Promise<void> {
  await bestEffortOrgSync("organization-created", () =>
    ensureOrgApiKey(
      data.member.userId,
      data.organization.id,
      toOrgRole(data.member.role)
    )
  );
}

export async function onMemberAdded(data: { member: MemberLike }): Promise<void> {
  await bestEffortOrgSync("member-added", () =>
    ensureOrgApiKey(
      data.member.userId,
      data.member.organizationId,
      toOrgRole(data.member.role)
    )
  );
}

export async function onMemberRemoved(data: { member: MemberLike }): Promise<void> {
  await bestEffortOrgSync("member-removed", () =>
    deleteOrgApiKey(data.member.userId, data.member.organizationId)
  );
}

// /organization/leave 的兜底（见上表）。入参来自 leave 响应的 member 对象。
export async function onMemberLeft(userId: string, organizationId: string): Promise<void> {
  await bestEffortOrgSync("member-left", () => deleteOrgApiKey(userId, organizationId));
}

export async function onMemberRoleUpdated(data: { member: MemberLike }): Promise<void> {
  await bestEffortOrgSync("member-role-updated", () =>
    ensureOrgApiKey(
      data.member.userId,
      data.member.organizationId,
      toOrgRole(data.member.role)
    )
  );
}

export async function onOrganizationDeleted(data: {
  organization: { id: string };
}): Promise<void> {
  await bestEffortOrgSync("organization-deleted", () =>
    deleteAllOrgApiKeys(data.organization.id)
  );
}
