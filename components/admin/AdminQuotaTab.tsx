"use client";

import { useCallback, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface QuotaRow {
  user_id: string;
  email: string | null;
  today_count: number;
  daily_limit: number | null;
  daily_index_bytes_limit: number | null;
  effective_daily_limit: number;
  effective_daily_index_bytes_limit: number;
  daily_limit_source: UserQuotaSource;
  daily_index_bytes_limit_source: UserQuotaSource;
  base_tier: "free" | "pro";
  subscription_plan_name: string | null;
}

type UserQuotaSource =
  | "admin_override"
  | "subscription"
  | "base_tier"
  | "platform_default";

function sourceLabel(source: UserQuotaSource, quota: QuotaRow): string {
  switch (source) {
    case "admin_override":
      return "管理员覆盖";
    case "subscription":
      return quota.subscription_plan_name
        ? `套餐 ${quota.subscription_plan_name}`
        : "有效套餐";
    case "base_tier":
      return `基础 ${quota.base_tier === "pro" ? "Pro" : "Free"}`;
    default:
      return "平台 Free 默认";
  }
}

function formatBytes(value: number): string {
  if (value === 0) return "不限";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
}

export function AdminQuotaTab() {
  const [quotas, setQuotas] = useState<QuotaRow[] | null>(null);
  const [defaultLimit, setDefaultLimit] = useState(0);
  const [defaultIndexBytesLimit, setDefaultIndexBytesLimit] = useState(0);
  const [proLimit, setProLimit] = useState(0);
  const [proIndexBytesLimit, setProIndexBytesLimit] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [requestDrafts, setRequestDrafts] = useState<Record<string, string>>({});
  const [indexDrafts, setIndexDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  // load 首个语句即 await，setState 均在 await 之后（满足
  // react-hooks/set-state-in-effect）；effect 发起的请求携带 AbortSignal，
  // 卸载时 abort，之后不再 setState。
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/admin/quotas", { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (signal?.aborted) return;
      setQuotas(data.quotas);
      setDefaultLimit(data.defaultLimit);
      setDefaultIndexBytesLimit(data.defaultIndexBytesLimit);
      setProLimit(data.proLimit);
      setProIndexBytesLimit(data.proIndexBytesLimit);
      setRequestDrafts({});
      setIndexDrafts({});
      setError("");
    } catch {
      if (signal?.aborted) return;
      setError("配额列表加载失败");
    }
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    // 经微任务发起以满足 react-hooks/set-state-in-effect；cleanup 时 abort，
    // load 内的 signal.aborted 检查保证之后不再 setState
    const controller = new AbortController();
    Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);

  const save = useCallback(
    async (userId: string) => {
      const parseDraft = (rawValue: string): number | null | undefined => {
        const raw = rawValue.trim();
        if (raw === "") return null;
        if (!/^\d+$/.test(raw)) return undefined;
        const parsed = Number(raw);
        return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
      };
      const requestLimit = parseDraft(requestDrafts[userId] ?? "");
      const indexBytesLimit = parseDraft(indexDrafts[userId] ?? "");
      if (requestLimit === undefined || indexBytesLimit === undefined) {
        setNotice("两个配额都必须是 ≥0 的整数（0 = 不限，留空 = 默认）");
        return;
      }
      setBusy(userId);
      setNotice("");
      try {
        const res = await fetch("/api/admin/quotas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, requestLimit, indexBytesLimit }),
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
    [requestDrafts, indexDrafts, load]
  );

  if (quotas === null && !error) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 bg-white/[0.06] rounded-xl" />
        ))}
      </div>
    );
  }

  if (quotas === null) {
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
          最终额度按管理员覆盖、有效套餐、基础档位依次生效。Free：
          <span className="text-slate-300 font-mono ml-1">
            请求 {defaultLimit > 0 ? defaultLimit.toLocaleString() : "不限"}，索引{" "}
            {formatBytes(defaultIndexBytesLimit)}
          </span>
          ；Pro：
          <span className="text-slate-300 font-mono ml-1">
            请求 {proLimit > 0 ? proLimit.toLocaleString() : "不限"}，索引{" "}
            {formatBytes(proIndexBytesLimit)}
          </span>
        </p>
        <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}
          className="text-slate-400 hover:text-white shrink-0">
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
        </Button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {notice && (
        <p className={cn("text-xs", notice.startsWith("已保存") ? "text-emerald-400" : "text-red-400")}>
          {notice}
        </p>
      )}

      <div className="space-y-2">
        {quotas.map((q) => {
          const effective = q.effective_daily_limit;
          const over = effective > 0 && q.today_count >= effective;
          return (
            <div key={q.user_id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-[#0a0f1a]/60 border border-white/[0.06] rounded-xl px-3 sm:px-4 py-2.5">
              <span className="text-slate-300 text-sm truncate max-w-[180px] flex-1 min-w-[120px]">
                {q.email || q.user_id}
              </span>
              <span className={cn("text-xs font-mono whitespace-nowrap", over ? "text-red-400" : "text-slate-500")}>
                今日 {q.today_count.toLocaleString()}
                {effective > 0 && ` / ${effective.toLocaleString()}`}
              </span>
              {(q.daily_limit !== null || q.daily_index_bytes_limit !== null) && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border bg-cyan-500/10 text-cyan-400 border-cyan-500/20">
                  自定义
                </span>
              )}
              <div className="min-w-[170px] text-[10px] text-slate-500">
                <p>
                  请求 {effective === 0 ? "不限" : effective.toLocaleString()} / 日
                  <span className="text-slate-600">
                    {`（${sourceLabel(q.daily_limit_source, q)}）`}
                  </span>
                </p>
                <p>
                  索引 {formatBytes(q.effective_daily_index_bytes_limit)} / 日
                  <span className="text-slate-600">
                    {`（${sourceLabel(q.daily_index_bytes_limit_source, q)}）`}
                  </span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 ml-auto">
                <label className="flex items-center gap-1 text-[10px] text-slate-500">
                  请求
                  <input
                    value={requestDrafts[q.user_id] ?? (q.daily_limit === null ? "" : String(q.daily_limit))}
                    onChange={(e) => setRequestDrafts((d) => ({ ...d, [q.user_id]: e.target.value }))}
                    placeholder="默认"
                    inputMode="numeric"
                    className="w-20 bg-white/[0.03] border border-white/[0.08] rounded-lg px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40 text-right font-mono"
                  />
                </label>
                <label className="flex items-center gap-1 text-[10px] text-slate-500">
                  索引B
                <input
                  value={indexDrafts[q.user_id] ?? (q.daily_index_bytes_limit === null ? "" : String(q.daily_index_bytes_limit))}
                  onChange={(e) => setIndexDrafts((d) => ({ ...d, [q.user_id]: e.target.value }))}
                  placeholder="默认"
                  inputMode="numeric"
                  className="w-28 bg-white/[0.03] border border-white/[0.08] rounded-lg px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40 text-right font-mono"
                />
                </label>
                <Button variant="glass" size="sm" disabled={busy === q.user_id}
                  onClick={() => save(q.user_id)} className="h-7 px-2.5 text-xs">
                  保存
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-slate-600 text-[10px]">
        两个输入框均为每日上限：留空 = 按套餐或平台默认；0 = 不限；正整数 = 管理员覆盖。保存后立即清除 Relay 配额缓存。
      </p>
    </div>
  );
}
