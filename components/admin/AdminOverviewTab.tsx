"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

interface Overview {
  users: number;
  banned: number;
  totalRequests: number;
  requests24h: number;
  activeUsers24h: number;
  errors24h: number;
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <Card className="bg-[#0a0f1a]/60 border-white/[0.06]">
      <CardContent className="p-3 sm:p-4">
        <p className="text-slate-500 text-[10px] sm:text-xs mb-1">{label}</p>
        <p className={cn("text-lg sm:text-2xl font-medium", accent || "text-slate-200")}>
          {value.toLocaleString()}
        </p>
      </CardContent>
    </Card>
  );
}

export function AdminOverviewTab() {
  const t = useTranslations("AdminOverview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // load 的首个语句就是 await，setState 均在 await 之后（满足
  // react-hooks/set-state-in-effect）。effect 发起的请求携带 AbortSignal：
  // 卸载时 abort，请求被取消后不再 setState（signal.aborted 检查）。
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/admin/overview", { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (signal?.aborted) return;
      setOverview(data.overview);
      setError("");
    } catch {
      if (signal?.aborted) return;
      setError(t("failedToLoadTryAgain"));
    }
  }, [t]);

  const fetchData = useCallback(() => {
    setLoading(true);
    setError("");
    load().finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    // 经微任务发起以满足 react-hooks/set-state-in-effect；cleanup 时 abort，
    // load 内的 signal.aborted 检查保证之后不再 setState
    const controller = new AbortController();
    Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);

  if (!overview && !error) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 bg-white/[0.06] rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-slate-500 text-xs">{t("last24HoursAndAllTimeTotals")}</p>
        <Button variant="ghost" size="sm" onClick={fetchData} disabled={loading}
          className="text-slate-400 hover:text-white">
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
        </Button>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatCard label={t("registeredUsers")} value={overview.users} />
          <StatCard label={t("activeUsers24h")} value={overview.activeUsers24h} accent="text-cyan-400" />
          <StatCard label={t("requests24h")} value={overview.requests24h} accent="text-cyan-400" />
          <StatCard label={t("totalRequests")} value={overview.totalRequests} />
          <StatCard label={t("errors24h")} value={overview.errors24h}
            accent={overview.errors24h > 0 ? "text-red-400" : "text-slate-200"} />
          <StatCard label={t("bannedAccounts")} value={overview.banned}
            accent={overview.banned > 0 ? "text-red-400" : "text-slate-200"} />
        </div>
      )}
    </div>
  );
}
