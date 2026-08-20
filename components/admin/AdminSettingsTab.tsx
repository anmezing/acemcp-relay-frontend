"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

export function AdminSettingsTab() {
  const t = useTranslations("AdminSettings");
  const [registrationEnabled, setRegistrationEnabled] = useState<boolean | null>(null);
  const [registeredUsers, setRegisteredUsers] = useState(0);
  const [limitDraft, setLimitDraft] = useState("");
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
      setRegisteredUsers(data.registeredUsers ?? 0);
      setLimitDraft(data.registrationLimit == null ? "" : String(data.registrationLimit));
      setError("");
    } catch {
      if (signal?.aborted) return;
      setError(t("failedToLoadTryAgain"));
    }
  }, [t]);

  useEffect(() => {
    // 经微任务发起以满足 react-hooks/set-state-in-effect；cleanup 时 abort，
    // load 内的 signal.aborted 检查保证之后不再 setState
    const controller = new AbortController();
    Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);

  const toggle = useCallback(
    async (next: boolean) => {
      if (!next && !confirm(t("disableRegistrationNewUsersWillNotBe"))) {
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
        setNotice(t("savedAndAppliedImmediately"));
      } catch {
        setNotice(t("failedToSaveTryAgain"));
      } finally {
        setBusy(false);
      }
    },
    [t]
  );

  const saveLimit = useCallback(async () => {
    const value = limitDraft.trim() === "" ? null : Number(limitDraft);
    if (value !== null && (!Number.isInteger(value) || value < 1)) { setNotice(t("enterAPositiveIntegerOrLeaveBlank")); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ registrationLimit: value }) });
      if (!res.ok) throw new Error();
      setLimitDraft(value === null ? "" : String(value)); setNotice(t("registrationLimitSaved"));
    } catch { setNotice(t("failedToSaveTryAgain")); } finally { setBusy(false); }
  }, [limitDraft, t]);

  if (registrationEnabled === null && !error) {
    return <Skeleton className="h-32 bg-white/[0.06] rounded-xl" />;
  }

  if (registrationEnabled === null) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <p className="text-red-400 text-sm">{error}</p>
        <Button variant="glass" size="sm" onClick={() => load()} className="text-xs">
          {t("retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-xs text-red-400">{error}</p>}
      {notice && (
        <p className={cn("text-xs", /已保存|saved/i.test(notice) ? "text-emerald-400" : "text-red-400")}>
          {notice}
        </p>
      )}

      <Card className="bg-[#0a0f1a]/60 border-white/[0.06]">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[200px]">
              <h3 className="text-white text-sm font-medium">{t("registration")}</h3>
              <p className="text-slate-500 text-xs mt-1">
                {t("whenDisabledNewUsersCannotRegisterThrough")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={cn(
                "text-xs px-2 py-0.5 rounded border",
                registrationEnabled
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-red-500/10 text-red-400 border-red-500/20"
              )}>
                {registrationEnabled ? t("open") : t("closed")}
              </span>
              <Button variant="glass" size="sm" disabled={busy}
                onClick={() => toggle(!registrationEnabled)} className="text-xs">
                {registrationEnabled ? t("disable") : t("enable")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-[#0a0f1a]/60 border-white/[0.06]">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[220px]"><h3 className="text-white text-sm font-medium">{t("registrationLimit")}</h3><p className="text-slate-500 text-xs mt-1">{t("usersRegisteredNewRegistrationsAreRejectedWhen", {p0: registeredUsers})}</p></div>
            <input aria-label={t("registrationLimit")} value={limitDraft} onChange={(event) => setLimitDraft(event.target.value)} placeholder={t("unlimited")} inputMode="numeric" className="w-24 rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-sm text-white" />
            <Button variant="glass" size="sm" disabled={busy} onClick={saveLimit} className="text-xs">{t("saveLimit")}</Button>
          </div>
        </CardContent>
      </Card>

      <p className="text-slate-600 text-[10px]">
        {t("otherSystemSettingsIncludingDefaultDailyRequest")}
      </p>
    </div>
  );
}
