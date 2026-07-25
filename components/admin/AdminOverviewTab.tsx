"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface Overview {
  users: number;
  devices: number;
  banned: number;
  totalRequests: number;
  requests24h: number;
  activeUsers24h: number;
  errors24h: number;
  alerts24h: number;
}

interface AlertRow {
  id: number;
  user_id: string;
  email: string | null;
  device_id: string | null;
  kind: string;
  detail: string | null;
  created_at: string;
}

const ALERT_KIND_LABELS: Record<string, { label: string; className: string }> = {
  device_evicted: { label: "设备互踢", className: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  multi_ip: { label: "多 IP", className: "bg-red-500/10 text-red-400 border-red-500/20" },
  unregistered_device: { label: "未注册设备", className: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  missing_client_id: { label: "无设备标识", className: "bg-slate-500/10 text-slate-400 border-slate-500/20" },
};

export function alertKindBadge(kind: string) {
  const meta = ALERT_KIND_LABELS[kind] || {
    label: kind,
    className: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  };
  return (
    <span className={cn("text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap", meta.className)}>
      {meta.label}
    </span>
  );
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
  const [overview, setOverview] = useState<Overview | null>(null);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // load 的首个语句就是 await，之后的 setState 均为异步，满足
  // react-hooks/set-state-in-effect；loading 态只在按钮回调里同步设置。
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/overview");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setOverview(data.overview);
      setAlerts(data.alerts || []);
      setError("");
    } catch {
      setError("加载失败，请重试");
    }
  }, []);

  const fetchData = useCallback(() => {
    setLoading(true);
    setError("");
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

  if (!overview && !error) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-20 bg-white/[0.06] rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-48 bg-white/[0.06] rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-slate-500 text-xs">近 24 小时与累计概况</p>
        <Button variant="ghost" size="sm" onClick={fetchData} disabled={loading}
          className="text-slate-400 hover:text-white">
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
        </Button>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="注册用户" value={overview.users} />
          <StatCard label="活跃用户 (24h)" value={overview.activeUsers24h} accent="text-cyan-400" />
          <StatCard label="请求量 (24h)" value={overview.requests24h} accent="text-cyan-400" />
          <StatCard label="累计请求" value={overview.totalRequests} />
          <StatCard label="在册设备" value={overview.devices} />
          <StatCard label="错误 (24h)" value={overview.errors24h}
            accent={overview.errors24h > 0 ? "text-red-400" : "text-slate-200"} />
          <StatCard label="设备告警 (24h)" value={overview.alerts24h}
            accent={overview.alerts24h > 0 ? "text-amber-400" : "text-slate-200"} />
          <StatCard label="封禁账号" value={overview.banned}
            accent={overview.banned > 0 ? "text-red-400" : "text-slate-200"} />
        </div>
      )}

      <div>
        <h3 className="text-white text-sm font-medium mb-3">最近设备告警</h3>
        {alerts.length === 0 ? (
          <p className="text-slate-500 text-sm py-4 text-center">暂无告警</p>
        ) : (
          <div className="space-y-2">
            {alerts.map((a) => (
              <div key={a.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-[#0a0f1a]/60 border border-white/[0.06] rounded-lg px-3 py-2">
                {alertKindBadge(a.kind)}
                <span className="text-slate-300 text-xs truncate max-w-[180px]">{a.email || a.user_id}</span>
                {a.device_id && (
                  <span className="text-slate-600 text-[10px] font-mono truncate max-w-[120px]">{a.device_id}</span>
                )}
                <span className="text-slate-500 text-[10px] break-all flex-1 min-w-[140px]">{a.detail}</span>
                <span className="text-slate-600 text-[10px] whitespace-nowrap ml-auto">
                  {new Date(a.created_at).toLocaleString("zh-CN")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
