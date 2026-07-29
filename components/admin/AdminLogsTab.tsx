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
  const [notice, setNotice] = useState("");

  // load 首个语句即 await（setState 均在 await 之后，满足
  // react-hooks/set-state-in-effect）；effect 发起的请求携带 AbortSignal，
  // 卸载/筛选切换时 abort，之后不再 setState。
  const load = useCallback(async (targetPage: number, onlyErrors: boolean, signal?: AbortSignal) => {
    try {
      const res = await fetch(
        `/api/admin/logs?page=${targetPage}&errors=${onlyErrors ? 1 : 0}`,
        { signal }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (signal?.aborted) return;
      setLogs(data.logs);
      setPage(data.page);
      setHasMore(data.logs.length >= data.pageSize);
    } catch {
      if (signal?.aborted) return;
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

  const runMaintenance = useCallback(
    async (action: string, olderThanDays: number | undefined, confirmText: string) => {
      if (!confirm(confirmText)) return;
      setLoading(true);
      setNotice("");
      try {
        const res = await fetch("/api/admin/maintenance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, olderThanDays }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setNotice(`已清理 ${data.deleted} 条`);
        await load(1, errorsOnly);
      } catch {
        setNotice("清理失败，请重试");
      } finally {
        setLoading(false);
      }
    },
    [load, errorsOnly]
  );

  useEffect(() => {
    // 挂载/筛选变化时拉取数据；经微任务发起以满足
    // react-hooks/set-state-in-effect；cleanup 时 abort，load 内的
    // signal.aborted 检查保证过期响应不再写入 state
    const controller = new AbortController();
    Promise.resolve().then(() => load(1, errorsOnly, controller.signal));
    return () => controller.abort();
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

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="glass" size="sm" disabled={loading}
          onClick={() => runMaintenance("clear-logs", 30, "清理 30 天前的请求日志（含错误详情）？此操作不可撤销。")}
          className="h-7 px-2.5 text-[11px] text-slate-400">
          清理 30 天前日志
        </Button>
        <Button variant="glass" size="sm" disabled={loading}
          onClick={() => runMaintenance("clear-logs", undefined, "清空全部请求日志（含错误详情）？统计与排行历史快照不受影响，此操作不可撤销。")}
          className="h-7 px-2.5 text-[11px] text-red-400">
          清空全部日志
        </Button>
        <Button variant="glass" size="sm" disabled={loading}
          onClick={() => runMaintenance("clear-alerts", undefined, "清空全部设备告警？此操作不可撤销。")}
          className="h-7 px-2.5 text-[11px] text-red-400">
          清空设备告警
        </Button>
        {notice && (
          <span className={cn("text-xs", notice.startsWith("已清理") ? "text-emerald-400" : "text-red-400")}>
            {notice}
          </span>
        )}
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
