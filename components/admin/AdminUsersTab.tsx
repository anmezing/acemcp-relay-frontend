"use client";

import { useCallback, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, RefreshCw, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { authProviderLabels } from "@/lib/auth-provider";
import type { AppLocale } from "@/i18n/config";
import { useLocale, useTranslations } from "next-intl";

interface UserRow {
  id: string;
  email: string | null;
  name: string | null;
  created_at: string;
  request_count: number;
  last_request_at: string | null;
  banned: boolean;
  tier: "free" | "pro";
  base_tier: "free" | "pro";
  subscription_plan_name: string | null;
  subscription_expires_at: string | null;
  auth_providers: string[];
}

function fmtTime(value: string | null, locale: AppLocale) {
  return value ? new Date(value).toLocaleString(locale) : "—";
}

export function AdminUsersTab() {
  const locale = useLocale() as AppLocale;
  const t = useTranslations("AdminUsers");
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [notice, setNotice] = useState("");

  // load 首个语句即 await，setState 全部发生在 await 之后（满足
  // react-hooks/set-state-in-effect）；effect 发起的请求携带 AbortSignal，
  // 卸载时 abort，之后不再 setState。
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/admin/users", { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (signal?.aborted) return;
      setUsers(data.users);
      setError("");
    } catch {
      if (signal?.aborted) return;
      setError(t("failedToLoadUsers"));
    }
  }, [t]);

  const fetchUsers = useCallback(() => {
    setLoading(true);
    return load().finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    // 经微任务发起以满足 react-hooks/set-state-in-effect；cleanup 时 abort，
    // load 内的 signal.aborted 检查保证之后不再 setState
    const controller = new AbortController();
    Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);

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
        setNotice(t("operationCompleted"));
      } catch (error) {
        setNotice(t("operationFailed", {p0: error instanceof Error ? error.message : String(error)}));
      } finally {
        setActionBusy(false);
      }
    },
    [fetchUsers, t]
  );

  const filtered = (users || []).filter((u) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      (u.email || "").toLowerCase().includes(q) ||
      (u.name || "").toLowerCase().includes(q) ||
      u.id.toLowerCase().includes(q) ||
      authProviderLabels(Array.isArray(u.auth_providers) ? u.auth_providers : [])
        .some((provider) => provider.toLowerCase().includes(q))
    );
  });

  if (users === null && !error) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 bg-white/[0.06] rounded-xl" />
        ))}
      </div>
    );
  }

  if (users === null) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <p className="text-red-400 text-sm">{error}</p>
        <Button variant="glass" size="sm" onClick={fetchUsers} disabled={loading} className="text-xs">
          <RefreshCw className={cn("w-4 h-4 mr-1", loading && "animate-spin")} />
          {t("retry")}
        </Button>
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
            placeholder={t("searchEmailNameIdLoginMethod")}
            className="w-full bg-[#0a0f1a]/60 border border-white/[0.08] rounded-lg pl-9 pr-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40"
          />
        </div>
        <Button variant="ghost" size="sm" onClick={fetchUsers} disabled={loading}
          className="text-slate-400 hover:text-white shrink-0">
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
        </Button>
      </div>

      {notice && (
        <p className={cn("text-xs", /操作成功|completed/i.test(notice) ? "text-emerald-400" : "text-red-400")}>
          {notice}
        </p>
      )}

      <p className="text-slate-600 text-xs">{t("users", {p0: filtered.length})}</p>

      <div className="space-y-2">
        {filtered.map((u) => {
          const isOpen = expanded === u.id;
          const providerLabels = authProviderLabels(
            Array.isArray(u.auth_providers) ? u.auth_providers : []
          );
          return (
            <div key={u.id}
              className={cn(
                "bg-[#0a0f1a]/60 border rounded-xl transition-colors",
                u.banned ? "border-red-500/30" : "border-white/[0.06]"
              )}>
              <button
                onClick={() => setExpanded(isOpen ? null : u.id)}
                className="w-full text-left px-3 sm:px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                {isOpen
                  ? <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                  : <ChevronRight className="w-4 h-4 text-slate-600 shrink-0" />}
                <span className="text-slate-200 text-sm truncate max-w-[200px]">
                  {u.email || u.name || u.id}
                </span>
                <span
                  className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded border",
                    u.tier === "pro"
                      ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/20"
                      : "bg-white/[0.04] text-slate-500 border-white/[0.08]"
                  )}>
                  {u.tier === "pro" ? "Pro" : "Free"}
                </span>
                {u.subscription_plan_name && (
                  <span className="rounded border border-emerald-500/20 bg-emerald-500/[0.08] px-1.5 py-0.5 text-[10px] text-emerald-400">
                    {t("purchased")} {u.subscription_plan_name}
                  </span>
                )}
                {(providerLabels.length ? providerLabels : [t("unknownSource")]).map((provider) => (
                  <span
                    key={provider}
                    className="rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-slate-400"
                  >
                    {provider}
                  </span>
                ))}
                {u.banned && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded border bg-red-500/10 text-red-400 border-red-500/20">
                    {t("banned")}
                  </span>
                )}
                <span className="text-slate-500 text-xs ml-auto whitespace-nowrap">
                  {u.request_count.toLocaleString(locale)} {t("requests")}
                </span>
                <span className="text-slate-600 text-[10px] whitespace-nowrap hidden md:inline">
                  {t("last")} {fmtTime(u.last_request_at, locale)}
                </span>
              </button>

              {isOpen && (
                <div className="border-t border-white/[0.06] px-3 sm:px-4 py-3 space-y-4">
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
                    <span>ID: <span className="font-mono text-slate-400">{u.id}</span></span>
                    <span>{t("registered")} {fmtTime(u.created_at, locale)}</span>
                    <span>
                      {t("loginMethods")}
                      <span className="text-slate-300">
                        {providerLabels.join(", ") || t("unknownSource")}
                      </span>
                    </span>
                    {u.subscription_plan_name && (
                      <span>
                        {t("activePlan")}{u.subscription_plan_name}{t("until")} {" "}
                        {fmtTime(u.subscription_expires_at, locale)}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button variant="glass" size="sm" disabled={actionBusy}
                      onClick={() => {
                        if (confirm(t("resetThisUserSApiKeyAll"))) {
                          runAction(u.id, "reset-key");
                        }
                      }}
                      className="text-xs">
                      {t("resetKey")}
                    </Button>
                    {u.base_tier === "pro" ? (
                      <Button variant="glass" size="sm" disabled={actionBusy}
                        onClick={() => {
                          if (confirm(t("setThisUserSManualBaseTier"))) {
                            runAction(u.id, "set-tier", { tier: "free" });
                          }
                        }}
                        className="text-xs">
                        {t("setBaseTierToFree")}
                      </Button>
                    ) : (
                      <Button variant="glass" size="sm" disabled={actionBusy}
                        onClick={() => {
                          if (confirm(t("setThisUserSManualBaseTier2"))) {
                            runAction(u.id, "set-tier", { tier: "pro" });
                          }
                        }}
                        className="text-xs text-cyan-400">
                        {t("setBaseTierToPro")}
                      </Button>
                    )}
                    {u.banned ? (
                      <Button variant="glass" size="sm" disabled={actionBusy}
                        onClick={() => runAction(u.id, "unban")}
                        className="text-xs text-emerald-400">
                        {t("unban")}
                      </Button>
                    ) : (
                      <Button variant="glass" size="sm" disabled={actionBusy}
                        onClick={() => {
                          const reason = prompt(t("banReasonOptional"));
                          if (reason !== null && confirm(t("banThisAccountAllRequestsFromIt"))) {
                            runAction(u.id, "ban", reason ? { reason } : undefined);
                          }
                        }}
                        className="text-xs text-red-400">
                        {t("ban")}
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
