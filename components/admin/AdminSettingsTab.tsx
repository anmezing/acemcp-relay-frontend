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
  const [remainingSlots, setRemainingSlots] = useState<number | null>(null);
  const [slotsDraft, setSlotsDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [publishedClientVersion, setPublishedClientVersion] = useState<string | null>(null);
  const [minimumClientVersion, setMinimumClientVersion] = useState<string | null>(null);
  const [minimumClientVersionDraft, setMinimumClientVersionDraft] = useState("");
  const [versionPolicyLoading, setVersionPolicyLoading] = useState(true);
  const [versionPolicyBusy, setVersionPolicyBusy] = useState(false);
  const [versionPolicyError, setVersionPolicyError] = useState("");
  const [versionPolicyNotice, setVersionPolicyNotice] = useState("");

  // load 首个语句即 await，setState 均在 await 之后（满足
  // react-hooks/set-state-in-effect）；effect 发起的请求携带 AbortSignal，
  // 卸载时 abort，之后不再 setState。
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/admin/settings", { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (signal?.aborted) return;
      const loadedSlots = data.registrationSlots ?? data.registrationLimit ?? null;
      setRegistrationEnabled(data.registrationEnabled);
      setRegisteredUsers(data.registeredUsers ?? 0);
      setRemainingSlots(loadedSlots);
      setSlotsDraft(loadedSlots === null ? "" : String(loadedSlots));
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

  const loadVersionPolicy = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/client-version", { cache: "no-store", signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { latestVersion?: unknown; minimumVersion?: unknown };
      if (signal?.aborted) return;
      const latest = typeof data.latestVersion === "string" ? data.latestVersion : null;
      const minimum = typeof data.minimumVersion === "string" ? data.minimumVersion : null;
      setPublishedClientVersion(latest);
      setMinimumClientVersion(minimum);
      setMinimumClientVersionDraft(minimum ?? "");
      setVersionPolicyError("");
    } catch {
      if (signal?.aborted) return;
      setVersionPolicyError(t("clientVersionPolicyLoadFailed"));
    } finally {
      if (!signal?.aborted) setVersionPolicyLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve().then(() => loadVersionPolicy(controller.signal));
    return () => controller.abort();
  }, [loadVersionPolicy]);

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

  const saveSlots = useCallback(async () => {
    if (!registrationEnabled) return;
    const value = slotsDraft.trim() === "" ? null : Number(slotsDraft);
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
      setNotice(t("enterAPositiveIntegerOrLeaveBlank"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrationSlots: value }),
      });
      if (!res.ok) throw new Error();
      setRemainingSlots(value);
      setSlotsDraft(value === null ? "" : String(value));
      setNotice(t("registrationLimitSaved"));
    } catch {
      setNotice(t("failedToSaveTryAgain"));
    } finally {
      setBusy(false);
    }
  }, [slotsDraft, registrationEnabled, t]);

  const saveMinimumClientVersion = useCallback(async () => {
    setVersionPolicyBusy(true);
    setVersionPolicyNotice("");
    try {
      const res = await fetch("/api/admin/client-version-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minimumVersion: minimumClientVersionDraft.trim() || null }),
      });
      const body = await res.json().catch(() => ({})) as { minimumVersion?: unknown; error?: unknown };
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
      }
      const minimum = typeof body.minimumVersion === "string" ? body.minimumVersion : null;
      setMinimumClientVersion(minimum);
      setMinimumClientVersionDraft(minimum ?? "");
      setVersionPolicyError("");
      setVersionPolicyNotice(t("clientVersionPolicySaved"));
    } catch {
      setVersionPolicyNotice(t("clientVersionPolicySaveFailed"));
    } finally {
      setVersionPolicyBusy(false);
    }
  }, [minimumClientVersionDraft, t]);

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
                "inline-flex h-8 w-24 items-center justify-center rounded-md border px-3 text-xs",
                registrationEnabled
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-red-500/10 text-red-400 border-red-500/20"
              )}>
                {registrationEnabled ? t("open") : t("closed")}
              </span>
              <Button variant="glass" size="sm" disabled={busy}
                onClick={() => toggle(!registrationEnabled)} className="h-8 w-24 text-xs">
                {registrationEnabled ? t("disable") : t("enable")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {registrationEnabled && (
        <Card className="bg-[#0a0f1a]/60 border-white/[0.06]">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-[220px] flex-1">
                <h3 className="text-white text-sm font-medium">{t("registrationLimit")}</h3>
                <p className="mt-1 text-slate-500 text-xs">
                  {remainingSlots === null
                    ? t("usersRegisteredUnlimitedSlots", { p0: registeredUsers })
                    : t("usersRegisteredRemainingSlots", { p0: registeredUsers, p1: remainingSlots })}
                </p>
              </div>
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <input
                  aria-label={t("registrationLimit")}
                  disabled={busy}
                  value={slotsDraft}
                  onChange={(event) => setSlotsDraft(event.target.value)}
                  placeholder={t("unlimited")}
                  inputMode="numeric"
                  className="h-8 w-28 rounded-md border border-white/10 bg-black/20 px-2 text-sm text-white disabled:cursor-not-allowed"
                />
                <Button variant="glass" size="sm" disabled={busy} onClick={saveSlots} className="h-8 min-w-[72px] text-xs">
                  {t("saveLimit")}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-[#0a0f1a]/60 border-white/[0.06]">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-[240px] flex-1">
              <h3 className="text-white text-sm font-medium">{t("minimumClientVersion")}</h3>
              <p className="mt-1 text-slate-500 text-xs leading-5">
                {t("minimumClientVersionDescription")}
              </p>
              <p className="mt-2 text-[11px] text-slate-600">
                {t("publishedClientVersion", { version: publishedClientVersion ? `v${publishedClientVersion}` : t("temporarilyUnavailable") })}
                {minimumClientVersion ? ` · ${t("currentlyEnforced", { version: `v${minimumClientVersion}` })}` : ` · ${t("notEnforced")}`}
              </p>
              {versionPolicyError && <p className="mt-2 text-xs text-red-400">{versionPolicyError}</p>}
              {versionPolicyNotice && (
                <p className={cn("mt-2 text-xs", /已保存|saved/i.test(versionPolicyNotice) ? "text-emerald-400" : "text-red-400")}>{versionPolicyNotice}</p>
              )}
            </div>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <input
                aria-label={t("minimumClientVersion")}
                disabled={versionPolicyLoading || versionPolicyBusy}
                value={minimumClientVersionDraft}
                onChange={(event) => setMinimumClientVersionDraft(event.target.value)}
                placeholder={t("minimumClientVersionPlaceholder")}
                className="h-8 w-36 rounded-md border border-white/10 bg-black/20 px-2 font-mono text-sm text-white disabled:cursor-not-allowed"
              />
              <Button
                variant="glass"
                size="sm"
                disabled={versionPolicyLoading || versionPolicyBusy}
                onClick={saveMinimumClientVersion}
                className="h-8 min-w-[72px] text-xs"
              >
                {versionPolicyBusy ? t("saving") : t("saveMinimumVersion")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-slate-600 text-[10px]">
        {t("otherSystemSettingsIncludingDefaultDailyRequest")}
      </p>
    </div>
  );
}
