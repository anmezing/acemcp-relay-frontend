"use client";

import { useCallback, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface LogRow {
  id: string;
  user_id: string;
  email: string | null;
  status: string;
  status_code: number | null;
  request_path: string;
  request_method: string;
  request_timestamp: string;
  response_duration_ms: number | null;
  client_ip: string;
}

function statusColor(row: LogRow) {
  if (row.status === "pending") return "text-slate-500";
  if (row.status_code && row.status_code < 400) return "text-emerald-400";
  return "text-red-400";
}

export function AdminLogsTab() {
  const [logs, setLogs] = useState<LogRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  // load 首个语句即 await（setState 均在 await 之后，满足
  // react-hooks/set-state-in-effect）；loading 态只在按钮回调里设置。
  const load = useCallback(async (targetPage: number, onlyErrors: boolean) => {
    try {
      const res = await fetch(`/api/admin/logs?page=${targetPage}&errors=${onlyErrors ? 1 : 0}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setLogs(data.logs);
      setPage(data.page);
      setHasMore(data.logs.length >= data.pageSize);
    } catch {
      setLogs([]);
    }
  }, []);

  const fetchLogs = useCallback(
    (targetPage: number, onlyErrors: boolean) => {
      setLoading(true);
      load(targetPage, onlyErrors).finally(() => setLoading(false));
    },
    [load]
  );

  useEffect(() => {
    // 挂载/筛选变化时拉取数据；经微任务回调调用以满足
    // react-hooks/set-state-in-effect（effect 同步体内不允许触达 setState）
    let ignore = false;
    Promise.resolve().then(() => {
      if (!ignore) load(1, errorsOnly);
    });
    return () => {
      ignore = true;
    };
  }, [load, errorsOnly]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded-lg bg-white/[0.04] border border-white/[0.06] p-0.5">
          {[
            { label: "全部", value: false },
            { label: "仅错误", value: true },
          ].map((opt) => (
            <button key={opt.label}
              onClick={() => setErrorsOnly(opt.value)}
              className={cn(
                "px-3 py-1 text-xs rounded-md transition-all",
                errorsOnly === opt.value
                  ? "bg-cyan-500/20 text-cyan-400"
                  : "text-slate-400 hover:text-slate-200"
              )}>
              {opt.label}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={() => fetchLogs(page, errorsOnly)}
          disabled={loading} className="text-slate-400 hover:text-white ml-auto">
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
        </Button>
      </div>

      {logs === null ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 bg-white/[0.06] rounded-lg" />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <p className="text-slate-500 text-sm py-8 text-center">暂无日志</p>
      ) : (
        <div className="space-y-1.5">
          {logs.map((log) => (
            <div key={log.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-[#0a0f1a]/60 border border-white/[0.06] rounded-lg px-3 py-2">
              <span className={cn("text-xs font-mono w-10 shrink-0", statusColor(log))}>
                {log.status === "pending" ? "…" : log.status_code ?? "ERR"}
              </span>
              <span className="text-slate-400 text-[10px] font-mono shrink-0">{log.request_method}</span>
              <span className="text-slate-300 text-xs font-mono truncate flex-1 min-w-[120px]">
                {log.request_path}
              </span>
              <span className="text-slate-500 text-[10px] truncate max-w-[140px]">
                {log.email || log.user_id}
              </span>
              {log.response_duration_ms !== null && (
                <span className="text-slate-600 text-[10px] whitespace-nowrap">
                  {log.response_duration_ms}ms
                </span>
              )}
              <span className="text-slate-600 text-[10px] whitespace-nowrap">
                {new Date(log.request_timestamp).toLocaleString("zh-CN")}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-center gap-3">
        <Button variant="glass" size="sm" disabled={loading || page <= 1}
          onClick={() => fetchLogs(page - 1, errorsOnly)} className="text-xs">
          上一页
        </Button>
        <span className="text-slate-500 text-xs">第 {page} 页</span>
        <Button variant="glass" size="sm" disabled={loading || !hasMore}
          onClick={() => fetchLogs(page + 1, errorsOnly)} className="text-xs">
          下一页
        </Button>
      </div>
    </div>
  );
}
