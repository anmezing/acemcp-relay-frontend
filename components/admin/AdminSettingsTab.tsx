"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AdminSettingsTab() {
  const [registrationEnabled, setRegistrationEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // load 首个语句即 await，setState 均在 await 之后（满足
  // react-hooks/set-state-in-effect）；effect 发起的请求携带 AbortSignal，
  // 卸载时 abort，之后不再 setState。
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/admin/settings", { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (signal?.aborted) return;
      setRegistrationEnabled(data.registrationEnabled);
      setError("");
    } catch {
      if (signal?.aborted) return;
      setError("加载失败，请重试");
    }
  }, []);

  useEffect(() => {
    // 经微任务发起以满足 react-hooks/set-state-in-effect；cleanup 时 abort，
    // load 内的 signal.aborted 检查保证之后不再 setState
    const controller = new AbortController();
    Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);

  const toggle = useCallback(
    async (next: boolean) => {
      if (!next && !confirm("确认关闭注册？新用户将无法通过 OAuth 创建账号（已有用户不受影响）。")) {
        return;
      }
      setBusy(true);
      setNotice("");
      try {
        const res = await fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ registrationEnabled: next }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setRegistrationEnabled(next);
        setNotice("已保存，立即生效");
      } catch {
        setNotice("保存失败，请重试");
      } finally {
        setBusy(false);
      }
    },
    []
  );

  if (registrationEnabled === null && !error) {
    return <Skeleton className="h-32 bg-white/[0.06] rounded-xl" />;
  }

  if (registrationEnabled === null) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <p className="text-red-400 text-sm">{error}</p>
        <Button variant="glass" size="sm" onClick={() => load()} className="text-xs">
          重试
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-xs text-red-400">{error}</p>}
      {notice && (
        <p className={cn("text-xs", notice.startsWith("已保存") ? "text-emerald-400" : "text-red-400")}>
          {notice}
        </p>
      )}

      <Card className="bg-[#0a0f1a]/60 border-white/[0.06]">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[200px]">
              <h3 className="text-white text-sm font-medium">开放注册</h3>
              <p className="text-slate-500 text-xs mt-1">
                关闭后新用户无法通过 LinuxDo / GitHub 完成首次注册，已有账号登录不受影响。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={cn(
                "text-xs px-2 py-0.5 rounded border",
                registrationEnabled
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-red-500/10 text-red-400 border-red-500/20"
              )}>
                {registrationEnabled ? "开放中" : "已关闭"}
              </span>
              <Button variant="glass" size="sm" disabled={busy}
                onClick={() => toggle(!registrationEnabled)} className="text-xs">
                {registrationEnabled ? "关闭注册" : "开放注册"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-slate-600 text-[10px]">
        其余系统级开关（设备绑定模式 DEVICE_BINDING_MODE、默认配额
        DEFAULT_DAILY_REQUEST_LIMIT 等）为 relay 环境变量，修改 deploy/.env 后重启 relay 生效。
      </p>
    </div>
  );
}
