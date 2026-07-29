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
}

export function AdminQuotaTab() {
  const [quotas, setQuotas] = useState<QuotaRow[] | null>(null);
  const [defaultLimit, setDefaultLimit] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
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
      setDrafts({});
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
      const raw = (drafts[userId] ?? "").trim();
      let limit: number | null;
      if (raw === "") {
        limit = null; // 恢复默认
      } else {
        // 全量数字校验：parseInt("12abc") 会静默截断成 12，必须整串是数字
        if (!/^\d+$/.test(raw)) {
          setNotice("配额必须是 ≥0 的整数（0 = 不限，留空 = 默认）");
          return;
        }
        limit = Number(raw);
        if (!Number.isSafeInteger(limit) || limit < 0) {
          setNotice("配额必须是 ≥0 的整数（0 = 不限，留空 = 默认）");
          return;
        }
      }
      setBusy(userId);
      setNotice("");
      try {
        const res = await fetch("/api/admin/quotas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, limit }),
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
          每用户每日请求上限，超限返回 429。全局默认：
          <span className="text-slate-300 font-mono ml-1">
            {defaultLimit > 0 ? `${defaultLimit}/天` : "不限"}
          </span>
          （由 `DEFAULT_DAILY_REQUEST_LIMIT` 控制）
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
          const effective = q.daily_limit === null ? defaultLimit : q.daily_limit;
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
              {q.daily_limit !== null && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border bg-cyan-500/10 text-cyan-400 border-cyan-500/20">
                  自定义
                </span>
              )}
              <div className="flex items-center gap-2 ml-auto">
                <input
                  value={drafts[q.user_id] ?? (q.daily_limit === null ? "" : String(q.daily_limit))}
                  onChange={(e) => setDrafts((d) => ({ ...d, [q.user_id]: e.target.value }))}
                  placeholder="默认"
                  inputMode="numeric"
                  className="w-20 bg-white/[0.03] border border-white/[0.08] rounded-lg px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40 text-right font-mono"
                />
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
        输入框留空 = 跟随全局默认；0 = 不限；正整数 = 该用户每日上限。保存后立即生效（含正在使用中的客户端）。
      </p>
    </div>
  );
}
