"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

interface CallStats {
  totals: { today: number; last30d: number; total: number };
  daily: { date: string; count: number }[];
  byPath: { path: string; count: number }[];
  topUsers: { user_id: string; email: string | null; count: number }[];
}

function Bar({
  value,
  max,
  label,
  count,
  labelClassName = "text-slate-500 w-20",
  trackClassName = "flex-1 h-4",
  fillClassName = "bg-cyan-500/30",
}: {
  value: number;
  max: number;
  label: string;
  count: number;
  labelClassName?: string;
  trackClassName?: string;
  fillClassName?: string;
}) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className={cn("text-[10px] font-mono shrink-0", labelClassName)}>{label}</span>
      <div className={cn("bg-white/[0.03] rounded overflow-hidden", trackClassName)}>
        <div className={cn("h-full rounded", fillClassName)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-slate-400 text-[10px] font-mono w-14 text-right shrink-0">
        {count.toLocaleString()}
      </span>
    </div>
  );
}

export function AdminStatsTab() {
  const t = useTranslations("AdminStats");
  const [stats, setStats] = useState<CallStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // load 首个语句即 await（满足 react-hooks/set-state-in-effect）；
  // effect 发起的请求携带 AbortSignal，卸载时 abort，之后不再 setState。
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/admin/stats", { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (signal?.aborted) return;
      setStats(data);
      setError("");
    } catch {
      if (signal?.aborted) return;
      setError(t("failedToLoadTryAgain"));
    }
  }, [t]);

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

  if (!stats && !error) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 bg-white/[0.06] rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 bg-white/[0.06] rounded-xl" />
      </div>
    );
  }

  const dailyMax = Math.max(...(stats?.daily.map((d) => d.count) || [0]), 1);
  const pathMax = Math.max(...(stats?.byPath.map((p) => p.count) || [0]), 1);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-slate-500 text-xs">
          {t("requestBasedStatisticsTokenAndEmbeddingRerank")}
        </p>
        <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}
          className="text-slate-400 hover:text-white">
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
        </Button>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {stats && (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: t("today"), value: stats.totals.today, accent: "text-cyan-400" },
              { label: t("last30Days"), value: stats.totals.last30d, accent: "text-slate-200" },
              { label: t("allTime"), value: stats.totals.total, accent: "text-slate-200" },
            ].map((s) => (
              <Card key={s.label} className="bg-[#0a0f1a]/60 border-white/[0.06]">
                <CardContent className="p-3 sm:p-4">
                  <p className="text-slate-500 text-[10px] sm:text-xs mb-1">{s.label}</p>
                  <p className={cn("text-lg sm:text-2xl font-medium", s.accent)}>
                    {s.value.toLocaleString()}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div>
            <h3 className="text-white text-sm font-medium mb-3">{t("requestsOver14Days")}</h3>
            <div className="space-y-1.5">
              {stats.daily.length === 0 && <p className="text-slate-600 text-xs">{t("noData")}</p>}
              {stats.daily.map((d) => (
                <Bar key={d.date} value={d.count} max={dailyMax} label={d.date.slice(5)} count={d.count} />
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-white text-sm font-medium mb-3">{t("endpointsOver30Days")}</h3>
            <div className="space-y-1.5">
              {stats.byPath.map((p) => (
                <Bar key={p.path} value={p.count} max={pathMax} label={p.path} count={p.count}
                  labelClassName="text-slate-400 flex-1 truncate"
                  trackClassName="w-32 sm:w-48 h-3 shrink-0"
                  fillClassName="bg-blue-500/30" />
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-white text-sm font-medium mb-3">{t("usersOver30Days")}</h3>
            <div className="space-y-1.5">
              {stats.topUsers.map((u, i) => (
                <div key={u.user_id}
                  className="flex items-center gap-3 bg-[#0a0f1a]/60 border border-white/[0.06] rounded-lg px-3 py-2">
                  <span className="text-slate-600 text-xs font-mono w-5">{i + 1}</span>
                  <span className="text-slate-300 text-xs truncate flex-1">{u.email || u.user_id}</span>
                  <span className="text-slate-400 text-xs font-mono">{u.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
