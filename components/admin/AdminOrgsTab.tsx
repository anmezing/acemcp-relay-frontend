"use client";

import { useCallback, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

interface AdminOrgRow {
  org_id: string;
  name: string;
  slug: string;
  owner_email: string | null;
  member_count: number;
  requests_7d: number;
  daily_request_limit: number | null;
  daily_index_bytes_limit: number | null;
  effective_daily_request_limit: number;
  effective_daily_index_bytes_limit: number;
  daily_request_source: OrgQuotaSource;
  daily_index_bytes_source: OrgQuotaSource;
  plan_name: string | null;
  owner_tier: "free" | "pro";
}

type OrgQuotaSource =
  | "admin_override"
  | "subscription"
  | "owner_tier"
  | "platform_default";

function formatLimit(value: number, unlimited: string, bytes = false): string {
  if (value === 0) return unlimited;
  if (!bytes) return value.toLocaleString();
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
}

// 平台管理员：组织列表 + 共享配额池分配（org_quotas，relay 消费）。
// 跟随 AdminQuotaTab 的行内编辑风格。
export function AdminOrgsTab() {
  const t = useTranslations("AdminOrganizations");
  const [orgs, setOrgs] = useState<AdminOrgRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { req: string; bytes: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [noticeOk, setNoticeOk] = useState(false);

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
      setError(t("failedToLoadOrganizations"));
    }
  }, [t]);

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
        setNotice(t("quotaMustBeANonNegativeInteger"));
        setNoticeOk(false);
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
        setNotice(t("savedAndAppliedImmediately"));
        setNoticeOk(true);
      } catch {
        setNotice(t("failedToSaveTryAgain"));
        setNoticeOk(false);
      } finally {
        setBusy(null);
      }
    },
    [drafts, load, t]
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
          {t("retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-slate-500 text-xs">
          {t("sharedQuotaDescription")}
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
        <p className={cn("text-xs", noticeOk ? "text-emerald-400" : "text-red-400")}>
          {notice}
        </p>
      )}

      {orgs.length === 0 && (
        <p className="text-slate-500 text-sm text-center py-6">{t("noOrganizations")}</p>
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
                  {t("memberCount", { count: org.member_count })}
                  <span className="text-slate-700"> · </span>
                  {t("requestsInPast7Days", { count: org.requests_7d ?? 0 })}
                </p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500">
                  <span>
                    {t("effectiveRequests")} {formatLimit(org.effective_daily_request_limit, t("unlimited"))} / {t("day")}
                    <span className="text-slate-600">
                      {` (${org.daily_request_source === "subscription" && !org.plan_name
                        ? t("quotaSource.activePlan")
                        : t(`quotaSource.${org.daily_request_source}`, { plan: org.plan_name || "", tier: org.owner_tier === "pro" ? "Pro" : "Free" })})`}
                    </span>
                  </span>
                  <span>
                    {t("effectiveIndex")} {formatLimit(org.effective_daily_index_bytes_limit, t("unlimited"), true)} / {t("day")}
                    <span className="text-slate-600">
                      {` (${org.daily_index_bytes_source === "subscription" && !org.plan_name
                        ? t("quotaSource.activePlan")
                        : t(`quotaSource.${org.daily_index_bytes_source}`, { plan: org.plan_name || "", tier: org.owner_tier === "pro" ? "Pro" : "Free" })})`}
                    </span>
                  </span>
                </div>
              </div>
              {(org.daily_request_limit !== null || org.daily_index_bytes_limit !== null) && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border bg-cyan-500/10 text-cyan-400 border-cyan-500/20">
                  {t("adminOverride")}
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
                  placeholder={t("requestsPerDay")}
                  inputMode="numeric"
                  title={t("dailyRequestLimitTitle")}
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
                  placeholder={t("indexBytesPerDay")}
                  inputMode="numeric"
                  title={t("dailyIndexLimitTitle")}
                  className="w-28 bg-white/[0.03] border border-white/[0.08] rounded-lg px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40 text-right font-mono"
                />
                <Button
                  variant="glass"
                  size="sm"
                  disabled={busy === org.org_id}
                  onClick={() => save(org)}
                  className="h-7 px-2.5 text-xs"
                >
                  {t("save")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-slate-600 text-[10px]">
        {t("overrideHint")}
      </p>
    </div>
  );
}
