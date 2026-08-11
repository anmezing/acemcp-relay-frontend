"use client";

import { useCallback, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface AdminOrgRow {
  org_id: string;
  name: string;
  slug: string;
  owner_email: string | null;
  member_count: number;
  requests_7d: number;
  daily_request_limit: number | null;
  daily_index_bytes_limit: number | null;
}

// 平台管理员：组织列表 + 共享配额池分配（org_quotas，relay 消费）。
// 跟随 AdminQuotaTab 的行内编辑风格。
export function AdminOrgsTab() {
  const [orgs, setOrgs] = useState<AdminOrgRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { req: string; bytes: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/admin/orgs", { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (signal?.aborted) return;
      setOrgs(data.orgs);
      setDrafts({});
      setError("");
    } catch {
      if (signal?.aborted) return;
      setError("组织列表加载失败");
    }
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);

  const parseDraft = (raw: string): number | null | undefined => {
    const v = raw.trim();
    if (v === "") return null;
    if (!/^\d+$/.test(v)) return undefined;
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : undefined;
  };

  const save = useCallback(
    async (org: AdminOrgRow) => {
      const draft = drafts[org.org_id] ?? {
        req: org.daily_request_limit === null ? "" : String(org.daily_request_limit),
        bytes: org.daily_index_bytes_limit === null ? "" : String(org.daily_index_bytes_limit),
      };
      const req = parseDraft(draft.req);
      const bytes = parseDraft(draft.bytes);
      if (req === undefined || bytes === undefined) {
        setNotice("配额必须是 ≥0 的整数（留空 = 未设置/默认）");
        return;
      }
      setBusy(org.org_id);
      setNotice("");
      try {
        const res = await fetch("/api/admin/orgs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orgId: org.org_id,
            dailyRequestLimit: req,
            dailyIndexBytesLimit: bytes,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await load();
        setNotice("已保存，立即生效");
      } catch {
        setNotice("保存失败，请重试");
      } finally {
        setBusy(null);
      }
    },
    [drafts, load]
  );

  if (orgs === null && !error) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 bg-white/[0.06] rounded-xl" />
        ))}
      </div>
    );
  }

  if (orgs === null) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <p className="text-red-400 text-sm">{error}</p>
        <Button variant="glass" size="sm" onClick={refresh} disabled={loading} className="text-xs">
          <RefreshCw className={cn("w-4 h-4 mr-1", loading && "animate-spin")} />
          重试
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-slate-500 text-xs">
          组织共享配额池：全组织每日请求上限与每日索引字节上限，超限整个组织受限。
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={refresh}
          disabled={loading}
          className="text-slate-400 hover:text-white shrink-0"
        >
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
        </Button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {notice && (
        <p className={cn("text-xs", notice.startsWith("已保存") ? "text-emerald-400" : "text-red-400")}>
          {notice}
        </p>
      )}

      {orgs.length === 0 && (
        <p className="text-slate-500 text-sm text-center py-6">暂无组织</p>
      )}

      <div className="space-y-2">
        {orgs.map((org) => {
          const draft = drafts[org.org_id];
          return (
            <div
              key={org.org_id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-[#0a0f1a]/60 border border-white/[0.06] rounded-xl px-3 sm:px-4 py-2.5"
            >
              <div className="flex-1 min-w-[160px]">
                <p className="text-slate-200 text-sm truncate">{org.name}</p>
                <p className="text-slate-600 text-[11px] truncate">
                  owner: {org.owner_email || "-"}
                  <span className="text-slate-700"> · </span>
                  {org.member_count} 名成员
                  <span className="text-slate-700"> · </span>
                  近 7 天 {(org.requests_7d ?? 0).toLocaleString()} 请求
                </p>
              </div>
              {(org.daily_request_limit !== null || org.daily_index_bytes_limit !== null) && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border bg-cyan-500/10 text-cyan-400 border-cyan-500/20">
                  已分配
                </span>
              )}
              <div className="flex items-center gap-2 ml-auto">
                <input
                  value={draft?.req ?? (org.daily_request_limit === null ? "" : String(org.daily_request_limit))}
                  onChange={(e) =>
                    setDrafts((d) => ({
                      ...d,
                      [org.org_id]: {
                        req: e.target.value,
                        bytes:
                          d[org.org_id]?.bytes ??
                          (org.daily_index_bytes_limit === null ? "" : String(org.daily_index_bytes_limit)),
                      },
                    }))
                  }
                  placeholder="请求/日"
                  inputMode="numeric"
                  title="每日请求上限（留空 = 未设置）"
                  className="w-24 bg-white/[0.03] border border-white/[0.08] rounded-lg px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40 text-right font-mono"
                />
                <input
                  value={draft?.bytes ?? (org.daily_index_bytes_limit === null ? "" : String(org.daily_index_bytes_limit))}
                  onChange={(e) =>
                    setDrafts((d) => ({
                      ...d,
                      [org.org_id]: {
                        req:
                          d[org.org_id]?.req ??
                          (org.daily_request_limit === null ? "" : String(org.daily_request_limit)),
                        bytes: e.target.value,
                      },
                    }))
                  }
                  placeholder="索引字节/日"
                  inputMode="numeric"
                  title="每日索引字节上限（留空 = 未设置）"
                  className="w-28 bg-white/[0.03] border border-white/[0.08] rounded-lg px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40 text-right font-mono"
                />
                <Button
                  variant="glass"
                  size="sm"
                  disabled={busy === org.org_id}
                  onClick={() => save(org)}
                  className="h-7 px-2.5 text-xs"
                >
                  保存
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-slate-600 text-[10px]">
        输入框留空 = 未设置（relay 按默认策略处理）；0 = 不限；正整数 = 上限。保存后立即生效。
      </p>
    </div>
  );
}
