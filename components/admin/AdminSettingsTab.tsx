"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AdminSettingsTab() {
  const [registrationEnabled, setRegistrationEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/settings");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRegistrationEnabled((await res.json()).registrationEnabled);
      setNotice("");
    } catch {
      setNotice("加载失败，请重试");
    }
  }, []);

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

  if (registrationEnabled === null && !notice) {
    return <Skeleton className="h-32 bg-white/[0.06] rounded-xl" />;
  }

  return (
    <div className="space-y-4">
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
              <Button variant="glass" size="sm" disabled={busy || registrationEnabled === null}
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
