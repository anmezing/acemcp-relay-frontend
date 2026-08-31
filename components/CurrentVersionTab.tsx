"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface VersionData {
  packageName: string;
  latestVersion: string | null;
  minimumVersion: string | null;
  latestVersionSource: "registry" | null;
  indexClientVersionRequired: boolean;
  warnings: string[];
}

export function CurrentVersionTab() {
  const t = useTranslations("CurrentVersion");
  const [data, setData] = useState<VersionData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch("/api/client-version", { cache: "no-store", signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json() as VersionData;
      if (signal?.aborted) return;
      setData(body);
      setError("");
    } catch {
      if (signal?.aborted) return;
      setError(t("loadFailed"));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);

  if (loading && !data) {
    return <Skeleton className="h-56 rounded-xl bg-white/[0.06]" />;
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center gap-3 py-10">
        <p className="text-sm text-red-400">{error || t("loadFailed")}</p>
        <Button variant="glass" size="sm" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" />{t("retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-cyan-500/20 bg-[#0a0f1a]/60">
          <CardContent className="p-5">
            <p className="text-xs text-slate-500">{t("publishedVersion")}</p>
            <div className="mt-2 flex items-center gap-2">
              <span className="font-mono text-2xl text-cyan-400">
                {data.latestVersion ? `v${data.latestVersion}` : t("temporarilyUnavailable")}
              </span>
              {data.latestVersionSource === "registry" && <Badge variant="outline">package registry</Badge>}
            </div>
            <p className="mt-2 text-xs text-slate-500">{data.packageName}</p>
          </CardContent>
        </Card>
        <Card className="border-white/[0.06] bg-[#0a0f1a]/60">
          <CardContent className="p-5">
            <p className="text-xs text-slate-500">{t("minimumVersion")}</p>
            <p className="mt-2 font-mono text-2xl text-white">
              {data.minimumVersion ? `v${data.minimumVersion}` : t("notConfigured")}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {data.indexClientVersionRequired ? t("oldClientsRejected") : t("oldClientsNotForced")}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-white/[0.06] bg-[#0a0f1a]/60">
        <CardContent className="space-y-3 p-5">
          <div>
            <h3 className="text-sm font-medium text-white">{t("upgradeTitle")}</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {t("upgradeDescription", { packageName: data.packageName })}
            </p>
          </div>
          <div className="space-y-1 text-xs leading-5 text-slate-500">
            <p>{t("managedUpdateNote")}</p>
            <p>{t("cannotDetectRunningVersion")}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
