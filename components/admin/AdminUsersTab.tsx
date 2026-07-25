"use client";

import { useCallback, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, RefreshCw, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { alertKindBadge } from "./AdminOverviewTab";

interface UserRow {
  id: string;
  email: string | null;
  name: string | null;
  created_at: string;
  request_count: number;
  last_request_at: string | null;
  device_count: number;
  banned: boolean;
}

interface UserDetail {
  devices: {
    device_id: string;
    device_name: string | null;
    created_at: string;
    last_seen_at: string;
    last_ip: string | null;
  }[];
  alerts: {
    id: number;
    device_id: string | null;
    kind: string;
    detail: string | null;
    created_at: string;
  }[];
}

function fmtTime(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN") : "—";
}

export function AdminUsersTab() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [notice, setNotice] = useState("");

  // load 首个语句即 await，setState 全部发生在 await 之后（满足
  // react-hooks/set-state-in-effect）；loading 态只在按钮/动作回调里设置。
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setUsers((await res.json()).users);
    } catch {
      setNotice("用户列表加载失败");
    }
  }, []);

  const fetchUsers = useCallback(() => {
    setLoading(true);
    return load().finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    // 经微任务回调调用以满足 react-hooks/set-state-in-effect
    let ignore = false;
    Promise.resolve().then(() => {
      if (!ignore) load();
    });
    return () => {
      ignore = true;
    };
  }, [load]);

  const openDetail = useCallback(async (userId: string) => {
    setExpanded(userId);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`);
      if (res.ok) setDetail(await res.json());
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const runAction = useCallback(
    async (userId: string, action: string, extra?: Record<string, string>) => {
      setActionBusy(true);
      setNotice("");
      try {
        const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...extra }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || `HTTP ${res.status}`);
        }
        await fetchUsers();
        if (expanded === userId) await openDetail(userId);
        setNotice("操作成功");
      } catch (error) {
        setNotice(`操作失败: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setActionBusy(false);
      }
    },
    [expanded, fetchUsers, openDetail]
  );

  const filtered = (users || []).filter((u) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      (u.email || "").toLowerCase().includes(q) ||
      (u.name || "").toLowerCase().includes(q) ||
      u.id.toLowerCase().includes(q)
    );
  });

  if (users === null) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 bg-white/[0.06] rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索邮箱 / 用户名 / ID"
            className="w-full bg-[#0a0f1a]/60 border border-white/[0.08] rounded-lg pl-9 pr-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40"
          />
        </div>
        <Button variant="ghost" size="sm" onClick={fetchUsers} disabled={loading}
          className="text-slate-400 hover:text-white shrink-0">
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
        </Button>
      </div>

      {notice && (
        <p className={cn("text-xs", notice.startsWith("操作成功") ? "text-emerald-400" : "text-red-400")}>
          {notice}
        </p>
      )}

      <p className="text-slate-600 text-xs">{filtered.length} 个用户</p>

      <div className="space-y-2">
        {filtered.map((u) => {
          const isOpen = expanded === u.id;
          return (
            <div key={u.id}
              className={cn(
                "bg-[#0a0f1a]/60 border rounded-xl transition-colors",
                u.banned ? "border-red-500/30" : "border-white/[0.06]"
              )}>
              <button
                onClick={() => (isOpen ? setExpanded(null) : openDetail(u.id))}
                className="w-full text-left px-3 sm:px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                {isOpen
                  ? <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                  : <ChevronRight className="w-4 h-4 text-slate-600 shrink-0" />}
                <span className="text-slate-200 text-sm truncate max-w-[200px]">
                  {u.email || u.name || u.id}
                </span>
                {u.banned && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded border bg-red-500/10 text-red-400 border-red-500/20">
                    已封禁
                  </span>
                )}
                <span className="text-slate-500 text-xs ml-auto whitespace-nowrap">
                  {u.request_count.toLocaleString()} 次请求
                </span>
                <span className="text-slate-600 text-xs whitespace-nowrap hidden sm:inline">
                  {u.device_count} 台设备
                </span>
                <span className="text-slate-600 text-[10px] whitespace-nowrap hidden md:inline">
                  最近 {fmtTime(u.last_request_at)}
                </span>
              </button>

              {isOpen && (
                <div className="border-t border-white/[0.06] px-3 sm:px-4 py-3 space-y-4">
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
                    <span>ID: <span className="font-mono text-slate-400">{u.id}</span></span>
                    <span>注册于 {fmtTime(u.created_at)}</span>
                  </div>

                  {detailLoading && <Skeleton className="h-16 bg-white/[0.06] rounded-lg" />}

                  {detail && (
                    <>
                      <div>
                        <p className="text-slate-400 text-xs mb-2">设备（{detail.devices.length}）</p>
                        {detail.devices.length === 0 ? (
                          <p className="text-slate-600 text-xs">无在册设备</p>
                        ) : (
                          <div className="space-y-1.5">
                            {detail.devices.map((d) => (
                              <div key={d.device_id}
                                className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-white/[0.02] rounded-lg px-2.5 py-1.5">
                                <span className="text-slate-300 text-xs">{d.device_name || "未知设备"}</span>
                                <span className="text-slate-600 text-[10px] font-mono truncate max-w-[140px]">
                                  {d.device_id}
                                </span>
                                {d.last_ip && <span className="text-slate-500 text-[10px]">{d.last_ip}</span>}
                                <span className="text-slate-600 text-[10px] whitespace-nowrap">
                                  活跃 {fmtTime(d.last_seen_at)}
                                </span>
                                <Button variant="ghost" size="sm" disabled={actionBusy}
                                  onClick={() => {
                                    if (confirm(`解绑设备 ${d.device_name || d.device_id}？该设备需重新登录。`)) {
                                      runAction(u.id, "remove-device", { deviceId: d.device_id });
                                    }
                                  }}
                                  className="ml-auto h-6 px-2 text-[10px] text-slate-400 hover:text-red-400">
                                  解绑
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {detail.alerts.length > 0 && (
                        <div>
                          <p className="text-slate-400 text-xs mb-2">最近告警</p>
                          <div className="space-y-1.5">
                            {detail.alerts.map((a) => (
                              <div key={a.id}
                                className="flex flex-wrap items-center gap-x-2 gap-y-1 bg-white/[0.02] rounded-lg px-2.5 py-1.5">
                                {alertKindBadge(a.kind)}
                                <span className="text-slate-500 text-[10px] break-all flex-1 min-w-[120px]">
                                  {a.detail}
                                </span>
                                <span className="text-slate-600 text-[10px] whitespace-nowrap">
                                  {fmtTime(a.created_at)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button variant="glass" size="sm" disabled={actionBusy}
                      onClick={() => {
                        if (confirm("重置该用户的 API Key？其所有客户端将立即掉线，需重新登录。")) {
                          runAction(u.id, "reset-key");
                        }
                      }}
                      className="text-xs">
                      重置密钥
                    </Button>
                    {u.banned ? (
                      <Button variant="glass" size="sm" disabled={actionBusy}
                        onClick={() => runAction(u.id, "unban")}
                        className="text-xs text-emerald-400">
                        解封
                      </Button>
                    ) : (
                      <Button variant="glass" size="sm" disabled={actionBusy}
                        onClick={() => {
                          const reason = prompt("封禁原因（可留空）：");
                          if (reason !== null && confirm("确认封禁该账号？其所有请求将被拒绝。")) {
                            runAction(u.id, "ban", reason ? { reason } : undefined);
                          }
                        }}
                        className="text-xs text-red-400">
                        封禁
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
