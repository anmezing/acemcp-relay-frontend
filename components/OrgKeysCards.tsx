"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, Copy, Crown, FileCode2 } from "lucide-react";
import { buildCloudMcpConfigJson } from "@/lib/mcp-config";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { CLIENT_RUNTIME_POLICY } from "@/lib/client-runtime-policy";

interface KeyListItem {
  orgId: string | null;
  orgName: string | null;
  orgRole: string | null;
  maskedKey: string;
  tier: "free" | "pro";
  createdAt: string;
}

// 密钥管理页的组织密钥区块：列出各组织密钥（归属徽标），支持复制密钥 /
// 一键复制该密钥的 MCP 配置。个人密钥卡片仍由 console 页原有 UI 负责。
export function OrgKeysCards() {
  const t = useTranslations("OrganizationKeys");
  const [keys, setKeys] = useState<KeyListItem[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<Record<string, string>>({});

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/keys", { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (signal?.aborted) return;
      setKeys((data.keys as KeyListItem[]).filter((k) => k.orgId !== null));
      setError("");
    } catch {
      if (signal?.aborted) return;
      setError(t("failedToLoadOrganizationKeys"));
    }
  }, [t]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);

  const flash = (orgId: string, message: string) => {
    setNotice((n) => ({ ...n, [orgId]: message }));
    window.setTimeout(() => {
      setNotice((n) => {
        const next = { ...n };
        delete next[orgId];
        return next;
      });
    }, CLIENT_RUNTIME_POLICY.noticeDurationMs);
  };

  const revealKey = async (orgId: string): Promise<string> => {
    const res = await fetch(`/api/key/reveal?orgId=${encodeURIComponent(orgId)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data.apiKey as string;
  };

  const copyKey = async (orgId: string) => {
    try {
      const key = await revealKey(orgId);
      await navigator.clipboard.writeText(key);
      flash(orgId, t("keyCopied"));
    } catch (e) {
      flash(orgId, e instanceof Error ? e.message : t("copyFailed"));
    }
  };

  const copyConfig = async (orgId: string) => {
    try {
      const res = await fetch("/api/mcp-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await navigator.clipboard.writeText(buildCloudMcpConfigJson(data.apiKey));
      flash(orgId, t("mcpConfigurationCopied"));
    } catch (e) {
      flash(orgId, e instanceof Error ? e.message : t("copyFailed"));
    }
  };

  if (keys === null && !error) {
    return <Skeleton className="h-16 w-full bg-white/[0.06]" />;
  }

  if (error) {
    return <p className="text-xs text-red-400">{error}</p>;
  }

  if (!keys || keys.length === 0) {
    return (
      <p className="text-slate-600 text-xs pt-4 border-t border-white/[0.06]">
        {t("noOrganizationKeysYetJoiningOrCreating")}
      </p>
    );
  }

  return (
    <div className="pt-4 border-t border-white/[0.06] space-y-3">
      <h3 className="text-sm font-medium text-white">{t("organizationKeys")}</h3>
      <p className="text-slate-600 text-xs">
        {t("useTheMatchingOrganizationKeyForCompany")}
      </p>
      {keys.map((k) => (
        <Card key={k.orgId} className="bg-[#0a0f1a]/60 border-white/[0.06]">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[160px]">
                <p className="text-slate-500 text-xs mb-1">
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded border bg-cyan-500/10 text-cyan-300 border-cyan-500/20 text-[10px]">
                    <Building2 className="w-3 h-3 mr-1" />
                    {k.orgName || k.orgId}
                  </span>
                  {k.orgRole === "owner" && (
                    <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded border bg-amber-500/10 text-amber-300 border-amber-500/30 text-[10px]">
                      <Crown className="w-3 h-3 mr-1" />
                      {t("owner")}
                    </span>
                  )}
                </p>
                <p className="text-white font-mono text-sm truncate">{k.maskedKey}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="glass" size="sm" onClick={() => k.orgId && copyKey(k.orgId)}>
                  <Copy className="w-4 h-4 mr-1" />
                  {t("copyKey")}
                </Button>
                <Button variant="glass" size="sm" onClick={() => k.orgId && copyConfig(k.orgId)}>
                  <FileCode2 className="w-4 h-4 mr-1" />
                  {t("copyConfig")}
                </Button>
              </div>
            </div>
            {k.orgId && notice[k.orgId] && (
              <p
                className={cn(
                  "text-xs mt-2",
                  /失败|failed|HTTP|不是/i.test(notice[k.orgId]) ? "text-red-400" : "text-emerald-400"
                )}
              >
                {notice[k.orgId]}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
