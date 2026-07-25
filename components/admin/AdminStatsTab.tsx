"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface CallStats {
  totals: { today: number; last30d: number; total: number };
  daily: { date: string; count: number }[];
  byPath: { path: string; count: number }[];
  topUsers: { user_id: string; email: string | null; count: number }[];
}

function Bar({ value, max, label, count }: { value: number; max: number; label: string; count: number }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-slate-500 text-[10px] font-mono w-20 shrink-0">{label}</span>
      <div className="flex-1 h-4 bg-white/[0.03] rounded overflow-hidden">
        <div className="h-full bg-cyan-500/30 rounded" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-slate-400 text-[10px] font-mono w-14 text-right shrink-0">
        {count.toLocaleString()}
      </span>
    </div>
  );
}

export function AdminStatsTab() {
  const [stats, setStats] = useState<CallStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/stats");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStats(await res.json());
      setError("");
    } catch {
      setError("加载失败，请重试");
    }
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
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
          按请求量统计（relay 无 token 计量，embedding/rerank 用量在 LCE 侧）
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
              { label: "今日请求", value: stats.totals.today, accent: "text-cyan-400" },
              { label: "近 30 天", value: stats.totals.last30d, accent: "text-slate-200" },
              { label: "累计", value: stats.totals.total, accent: "text-slate-200" },
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
            <h3 className="text-white text-sm font-medium mb-3">近 14 天请求量</h3>
            <div className="space-y-1.5">
              {stats.daily.length === 0 && <p className="text-slate-600 text-xs">暂无数据</p>}
              {stats.daily.map((d) => (
                <Bar key={d.date} value={d.count} max={dailyMax} label={d.date.slice(5)} count={d.count} />
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-white text-sm font-medium mb-3">近 30 天端点分布</h3>
            <div className="space-y-1.5">
              {stats.byPath.map((p) => (
                <div key={p.path} className="flex items-center gap-2">
                  <span className="text-slate-400 text-[10px] font-mono flex-1 truncate">{p.path}</span>
                  <div className="w-32 sm:w-48 h-3 bg-white/[0.03] rounded overflow-hidden shrink-0">
                    <div className="h-full bg-blue-500/30 rounded"
                      style={{ width: `${Math.max(2, Math.round((p.count / pathMax) * 100))}%` }} />
                  </div>
                  <span className="text-slate-400 text-[10px] font-mono w-14 text-right shrink-0">
                    {p.count.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-white text-sm font-medium mb-3">近 30 天用户排行</h3>
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
