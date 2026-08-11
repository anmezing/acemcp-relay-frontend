"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Building2, Copy, Crown, LogOut, RefreshCw, UserMinus } from "lucide-react";
import { cn } from "@/lib/utils";

interface OrgSummary {
  id: string;
  name: string;
  slug: string;
}

interface OrgMember {
  id: string;
  userId: string;
  role: string;
  user: { name?: string | null; email?: string | null };
}

interface OrgInvitation {
  id: string;
  email: string;
  status: string;
  role?: string | null;
  expiresAt?: string | Date | null;
}

interface OrgUsageData {
  daily: { date: string; count: number }[];
  topMembers: { user_id: string; email: string | null; name: string | null; count: number }[];
  // limit：null = 未设限，0 = 不限（org_quotas.daily_request_limit）
  today: { used: number; limit: number | null };
}

function isOwnerRole(role: string | null | undefined): boolean {
  return Boolean(role?.split(",").map((r) => r.trim()).includes("owner"));
}

// slug 由组织名派生：仅保留字母数字与连字符，冲突时由创建接口报错后加随机后缀重试
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || `org-${Math.random().toString(36).slice(2, 8)}`;
}

export function OrgTab({ currentUserId }: { currentUserId: string }) {
  const { data: orgs, isPending, refetch } = authClient.useListOrganizations();
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [members, setMembers] = useState<OrgMember[] | null>(null);
  const [invitations, setInvitations] = useState<OrgInvitation[] | null>(null);
  const [detailError, setDetailError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  // 创建组织
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);

  // 邀请
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLink, setInviteLink] = useState("");

  // 成员配额草稿
  const [quotaDrafts, setQuotaDrafts] = useState<Record<string, string>>({});

  // 确认弹窗
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    description: string;
    run: () => Promise<void>;
  } | null>(null);

  const orgList: OrgSummary[] = useMemo(
    () => (orgs ?? []).map((o) => ({ id: o.id, name: o.name, slug: o.slug })),
    [orgs]
  );
  const activeOrg = orgList.find((o) => o.id === activeOrgId) ?? orgList[0] ?? null;

  const myMember = members?.find((m) => m.userId === currentUserId) ?? null;
  const iAmOwner = isOwnerRole(myMember?.role);

  const loadDetail = useCallback(async (orgId: string) => {
    setDetailError("");
    try {
      const { data, error } = await authClient.organization.getFullOrganization({
        query: { organizationId: orgId },
      });
      if (error || !data) throw new Error(error?.message || "加载失败");
      const loadedMembers = (data.members as OrgMember[]) ?? [];
      setMembers(loadedMembers);
      setInvitations(
        ((data.invitations as OrgInvitation[]) ?? []).filter((i) => i.status === "pending")
      );
      setQuotaDrafts({});
      const caller = loadedMembers.find((member) => member.userId === currentUserId);
      if (isOwnerRole(caller?.role)) {
        const response = await fetch(
          `/api/org/member-quota?orgId=${encodeURIComponent(orgId)}`
        );
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          quotas?: { user_id: string; daily_limit: number }[];
        };
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        setQuotaDrafts(
          Object.fromEntries(
            (payload.quotas ?? []).map((quota) => [quota.user_id, String(quota.daily_limit)])
          )
        );
      }
    } catch (e) {
      setMembers(null);
      setInvitations(null);
      setQuotaDrafts({});
      setDetailError(e instanceof Error ? e.message : "组织详情加载失败");
    }
  }, [currentUserId]);

  useEffect(() => {
    if (!activeOrg) return;
    // 经微任务重置并拉取，满足 react-hooks/set-state-in-effect
    const timeoutId = window.setTimeout(() => {
      setMembers(null);
      setInviteLink("");
      setNotice("");
      void loadDetail(activeOrg.id);
    }, 0);
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrg?.id, loadDetail]);

  const handleCreate = async () => {
    const name = createName.trim();
    if (!name || creating) return;
    setCreating(true);
    setNotice("");
    try {
      let { data, error } = await authClient.organization.create({
        name,
        slug: slugify(name),
      });
      if (error?.code === "ORGANIZATION_ALREADY_EXISTS" || (error && /slug/i.test(error.message || ""))) {
        // slug 冲突：加随机后缀重试一次
        ({ data, error } = await authClient.organization.create({
          name,
          slug: `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`,
        }));
      }
      if (error || !data) throw new Error(error?.message || "创建失败");
      setCreateName("");
      setActiveOrgId(data.id);
      refetch?.();
      setNotice("组织已创建，你的组织密钥已自动生成（见密钥管理）");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "创建组织失败");
    } finally {
      setCreating(false);
    }
  };

  const handleInvite = async () => {
    if (!activeOrg) return;
    const email = inviteEmail.trim();
    if (!email) return;
    setBusy("invite");
    setNotice("");
    try {
      const { data, error } = await authClient.organization.inviteMember({
        email,
        role: "member",
        organizationId: activeOrg.id,
      });
      if (error || !data) throw new Error(error?.message || "邀请失败");
      const link = `${window.location.origin}/accept-invitation/${data.id}`;
      setInviteLink(link);
      setInviteEmail("");
      await loadDetail(activeOrg.id);
      try {
        await navigator.clipboard.writeText(link);
        setNotice("邀请已创建，链接已复制到剪贴板（48 小时内有效）");
      } catch {
        setNotice("邀请已创建，请手动复制链接（48 小时内有效）");
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "邀请失败");
    } finally {
      setBusy(null);
    }
  };

  const removeMember = (m: OrgMember) => {
    if (!activeOrg) return;
    setConfirmAction({
      title: "移除成员",
      description: `确定将 ${m.user.email || m.userId} 移出组织？其组织密钥将立即失效。`,
      run: async () => {
        const { error } = await authClient.organization.removeMember({
          memberIdOrEmail: m.id,
          organizationId: activeOrg.id,
        });
        if (error) throw new Error(error.message || "移除失败");
        await loadDetail(activeOrg.id);
        setNotice("已移除成员并吊销其组织密钥");
      },
    });
  };

  const transferOwner = (m: OrgMember) => {
    if (!activeOrg || !myMember) return;
    setConfirmAction({
      title: "转让所有者",
      description: `确定将组织所有者转让给 ${m.user.email || m.userId}？你将降级为普通成员。`,
      run: async () => {
        // 先升对方，再降自己；两把组织密钥的 org_role 由 hooks 同步
        const up = await authClient.organization.updateMemberRole({
          memberId: m.id,
          role: "owner",
          organizationId: activeOrg.id,
        });
        if (up.error) throw new Error(up.error.message || "转让失败");
        const down = await authClient.organization.updateMemberRole({
          memberId: myMember.id,
          role: "member",
          organizationId: activeOrg.id,
        });
        if (down.error) {
          throw new Error(
            `对方已升为所有者，但你的降级失败：${down.error.message || "请重试"}`
          );
        }
        await loadDetail(activeOrg.id);
        setNotice("所有者已转让");
      },
    });
  };

  const leaveOrg = () => {
    if (!activeOrg) return;
    setConfirmAction({
      title: "退出组织",
      description: "退出后你的组织密钥将立即失效，公司项目将无法继续使用该密钥。确定退出？",
      run: async () => {
        const { error } = await authClient.organization.leave({
          organizationId: activeOrg.id,
        });
        if (error) throw new Error(error.message || "退出失败");
        setActiveOrgId(null);
        setMembers(null);
        refetch?.();
        setNotice("已退出组织");
      },
    });
  };

  const saveMemberQuota = async (m: OrgMember) => {
    if (!activeOrg) return;
    const raw = (quotaDrafts[m.userId] ?? "").trim();
    let limit: number | null = null;
    if (raw !== "") {
      if (!/^\d+$/.test(raw)) {
        setNotice("配额必须是 ≥0 的整数（0 = 不限，留空 = 默认）");
        return;
      }
      limit = Number(raw);
    }
    setBusy(`quota:${m.userId}`);
    setNotice("");
    try {
      const res = await fetch("/api/org/member-quota", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: activeOrg.id, userId: m.userId, limit }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setNotice("成员配额已保存，立即生效");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(null);
    }
  };

  if (isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full bg-white/[0.06]" />
        <Skeleton className="h-32 w-full bg-white/[0.06]" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {notice && (
        <p className={cn("text-xs", /失败|错误|必须/.test(notice) ? "text-red-400" : "text-emerald-400")}>
          {notice}
        </p>
      )}

      {orgList.length === 0 ? (
        <Card className="bg-[#0a0f1a]/60 border-white/[0.06]">
          <CardContent className="p-6 text-center space-y-4">
            <Building2 className="w-8 h-8 text-slate-600 mx-auto" />
            <p className="text-slate-400 text-sm">
              你还没有加入任何组织。创建组织后会自动生成一把组织密钥，
              公司项目请使用组织密钥，个人项目继续使用个人密钥。
            </p>
            <div className="flex items-center justify-center gap-2">
              <input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="组织名称"
                className="w-48 bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40"
              />
              <Button variant="gradient" size="sm" onClick={handleCreate} disabled={creating || !createName.trim()}>
                {creating ? "创建中..." : "创建组织"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* 组织切换 + 新建 */}
          <div className="flex flex-wrap items-center gap-2">
            {orgList.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setActiveOrgId(o.id)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-sm border transition-colors",
                  activeOrg?.id === o.id
                    ? "bg-cyan-400/10 text-cyan-200 border-cyan-500/30"
                    : "text-slate-400 border-white/[0.08] hover:text-slate-200"
                )}
              >
                {o.name}
              </button>
            ))}
            <div className="flex items-center gap-2 ml-auto">
              <input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="新组织名称"
                className="w-36 bg-white/[0.03] border border-white/[0.08] rounded-lg px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40"
              />
              <Button variant="glass" size="sm" onClick={handleCreate} disabled={creating || !createName.trim()}>
                {creating ? "创建中..." : "创建"}
              </Button>
            </div>
          </div>

          {detailError && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-red-500/20 bg-red-500/[0.05] p-3">
              <p className="text-sm text-red-300">{detailError}</p>
              <Button variant="glass" size="sm" onClick={() => activeOrg && loadDetail(activeOrg.id)}>
                <RefreshCw className="w-4 h-4 mr-1" />
                重试
              </Button>
            </div>
          )}

          {/* 成员列表 */}
          {members === null && !detailError ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full bg-white/[0.06]" />
              <Skeleton className="h-12 w-full bg-white/[0.06]" />
            </div>
          ) : members !== null && (
            <>
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-white">成员（{members.length}）</h3>
                {members.map((m) => {
                  const owner = isOwnerRole(m.role);
                  const isSelf = m.userId === currentUserId;
                  return (
                    <div
                      key={m.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-[#0a0f1a]/60 border border-white/[0.06] rounded-xl px-3 sm:px-4 py-2.5"
                    >
                      <span className="text-slate-300 text-sm truncate max-w-[200px] flex-1 min-w-[140px]">
                        {m.user.name || m.user.email || m.userId}
                        {isSelf && <span className="text-slate-600 text-xs ml-1">（我）</span>}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px]",
                          owner
                            ? "bg-amber-500/10 text-amber-300 border-amber-500/30"
                            : "bg-white/[0.04] text-slate-400 border-white/[0.1]"
                        )}
                      >
                        {owner && <Crown className="w-3 h-3 mr-1" />}
                        {owner ? "所有者" : "成员"}
                      </Badge>
                      {iAmOwner && !isSelf && (
                        <div className="flex items-center gap-2 ml-auto">
                          <input
                            value={quotaDrafts[m.userId] ?? ""}
                            onChange={(e) =>
                              setQuotaDrafts((d) => ({ ...d, [m.userId]: e.target.value }))
                            }
                            placeholder="日上限"
                            inputMode="numeric"
                            title="该成员每日请求上限（留空=默认，0=不限）"
                            className="w-16 bg-white/[0.03] border border-white/[0.08] rounded-lg px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40 text-right font-mono"
                          />
                          <Button
                            variant="glass"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            disabled={busy === `quota:${m.userId}`}
                            onClick={() => saveMemberQuota(m)}
                          >
                            设上限
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-slate-500 hover:text-amber-300"
                            onClick={() => transferOwner(m)}
                          >
                            <Crown className="w-3.5 h-3.5 mr-1" />
                            转让
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-slate-500 hover:text-red-400"
                            onClick={() => removeMember(m)}
                          >
                            <UserMinus className="w-3.5 h-3.5 mr-1" />
                            移除
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 邀请（owner） */}
              {iAmOwner && (
                <Card className="bg-[#0a0f1a]/60 border-white/[0.06]">
                  <CardContent className="p-4 space-y-3">
                    <h3 className="text-sm font-medium text-white">邀请成员</h3>
                    <div className="flex items-center gap-2">
                      <input
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="成员邮箱"
                        type="email"
                        className="flex-1 bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40"
                      />
                      <Button
                        variant="gradient"
                        size="sm"
                        onClick={handleInvite}
                        disabled={busy === "invite" || !inviteEmail.trim()}
                      >
                        {busy === "invite" ? "生成中..." : "生成邀请链接"}
                      </Button>
                    </div>
                    {inviteLink && (
                      <div className="flex items-center gap-2 bg-[#0a0f1a] border border-white/[0.08] rounded-lg p-2">
                        <code className="text-cyan-300 text-xs truncate flex-1">{inviteLink}</code>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 shrink-0"
                          onClick={() => navigator.clipboard.writeText(inviteLink)}
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    )}
                    {invitations && invitations.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs text-slate-500">待接受的邀请</p>
                        {invitations.map((i) => (
                          <div key={i.id} className="flex items-center gap-2 text-xs text-slate-400">
                            <span className="truncate">{i.email}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-[10px] text-slate-500 hover:text-white"
                              onClick={() =>
                                navigator.clipboard.writeText(
                                  `${window.location.origin}/accept-invitation/${i.id}`
                                )
                              }
                            >
                              复制链接
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* 成员退出 */}
              {!iAmOwner && myMember && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={leaveOrg}
                  className="text-slate-500 hover:text-red-400 hover:bg-red-500/10"
                >
                  <LogOut className="w-4 h-4 mr-1" />
                  退出该组织
                </Button>
              )}

              <p className="text-slate-600 text-[10px]">
                公司项目请使用组织密钥（密钥管理页可复制配置），个人项目使用个人密钥。
                成员日上限：留空 = 默认；0 = 不限；保存后立即生效。
              </p>
            </>
          )}

          {/* 组织用量（owner/member 都可读，接口按组织成员鉴权） */}
          {activeOrg && <OrgUsageSection orgId={activeOrg.id} />}
        </>
      )}

      {/* 确认弹窗 */}
      <AlertDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
      >
        <AlertDialogContent className="bg-[#0d1424] border-white/[0.08]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">{confirmAction?.title}</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {confirmAction?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-transparent border-white/[0.08] text-slate-400 hover:text-white hover:bg-white/[0.06]">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const action = confirmAction;
                setConfirmAction(null);
                if (!action) return;
                try {
                  await action.run();
                } catch (e) {
                  setNotice(e instanceof Error ? e.message : "操作失败");
                }
              }}
              className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-white"
            >
              确认
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// 用量条形行：跟随 AdminStatsTab 的 Bar 样式（简化版）
function UsageBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-mono shrink-0 text-slate-500 w-14">{label}</span>
      <div className="flex-1 h-3 bg-white/[0.03] rounded overflow-hidden">
        <div className="h-full rounded bg-cyan-500/30" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-slate-400 text-[10px] font-mono w-14 text-right shrink-0">
        {value.toLocaleString()}
      </span>
    </div>
  );
}

// 组织用量（近 30 天）：/api/org/usage 按组织成员鉴权，owner/member 都可读。
// 索引字节用量本期不展示：request_logs 无字节数（计数在 relay 侧 Redis），
// 不放假数据。
function OrgUsageSection({ orgId }: { orgId: string }) {
  const [usage, setUsage] = useState<OrgUsageData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await fetch(`/api/org/usage?orgId=${encodeURIComponent(orgId)}`, { signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (signal?.aborted) return;
        setUsage(data);
        setError("");
      } catch {
        if (signal?.aborted) return;
        setError("组织用量加载失败");
      }
    },
    [orgId]
  );

  const refresh = useCallback(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    // 经微任务重置并拉取（切组织时清旧数据）；cleanup 时 abort，
    // load 内的 signal.aborted 检查保证之后不再 setState
    const controller = new AbortController();
    Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      setUsage(null);
      setError("");
      void load(controller.signal);
    });
    return () => controller.abort();
  }, [load]);

  const dailyMax = Math.max(...(usage?.daily.map((d) => d.count) || [0]), 1);

  return (
    <Card className="bg-[#0a0f1a]/60 border-white/[0.06]">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-white">用量（近 30 天）</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            disabled={loading}
            className="text-slate-400 hover:text-white"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </Button>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        {usage === null && !error ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full bg-white/[0.06]" />
            <Skeleton className="h-24 w-full bg-white/[0.06]" />
          </div>
        ) : (
          usage && (
            <>
              {/* 当日配额使用进度 */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs text-slate-500">今日请求 / 组织日配额</p>
                  <p className="text-xs font-mono text-slate-300">
                    {usage.today.used.toLocaleString()}
                    <span className="text-slate-600"> / </span>
                    {usage.today.limit === null
                      ? "未设限"
                      : usage.today.limit === 0
                        ? "不限"
                        : usage.today.limit.toLocaleString()}
                  </p>
                </div>
                {usage.today.limit !== null && usage.today.limit > 0 && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        usage.today.used >= usage.today.limit
                          ? "bg-red-500/60"
                          : "bg-gradient-to-r from-cyan-400 to-blue-500"
                      )}
                      style={{
                        width: `${Math.min(100, Math.round((usage.today.used / usage.today.limit) * 100))}%`,
                      }}
                    />
                  </div>
                )}
              </div>

              {/* 每日请求数 */}
              <div>
                <p className="text-xs text-slate-500 mb-2">每日请求数</p>
                {usage.daily.length === 0 ? (
                  <p className="text-slate-600 text-xs">暂无数据</p>
                ) : (
                  <div className="space-y-1.5">
                    {usage.daily.map((d) => (
                      <UsageBar key={d.date} label={d.date.slice(5)} value={d.count} max={dailyMax} />
                    ))}
                  </div>
                )}
              </div>

              {/* 成员请求 Top 分布 */}
              <div>
                <p className="text-xs text-slate-500 mb-2">成员请求 Top 分布</p>
                {usage.topMembers.length === 0 ? (
                  <p className="text-slate-600 text-xs">暂无数据</p>
                ) : (
                  <div className="space-y-1.5">
                    {usage.topMembers.map((m, i) => (
                      <div
                        key={m.user_id}
                        className="flex items-center gap-3 bg-[#0a0f1a]/60 border border-white/[0.06] rounded-lg px-3 py-2"
                      >
                        <span className="text-slate-600 text-xs font-mono w-5">{i + 1}</span>
                        <span className="text-slate-300 text-xs truncate flex-1">
                          {m.name || m.email || m.user_id}
                        </span>
                        <span className="text-slate-400 text-xs font-mono">
                          {m.count.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <p className="text-slate-600 text-[10px]">
                统计基于组织请求日志（tenant_id 自新版 relay 起回填，只覆盖新数据）；
                索引字节用量暂不提供。
              </p>
            </>
          )
        )}
      </CardContent>
    </Card>
  );
}
