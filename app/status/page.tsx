"use client";

import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { RefreshCw, Zap, Radio, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { LceBrand } from "@/components/LceBrand";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useLocale, useTranslations } from "next-intl";
import { CLIENT_RUNTIME_POLICY } from "@/lib/client-runtime-policy";

interface HealthCheck {
  id: number;
  status: string;
  tcpPingMs: number | null;
  codebaseRetrievalMs: number | null;
  errorMessage: string | null;
  createdAt: string;
}

interface HistoryData {
  history: HealthCheck[];
  stats: {
    successCount: number;
    totalCount: number;
  };
  nextCheckAt: string | null;
}

export default function StatusPage() {
  const locale = useLocale();
  const t = useTranslations("Status");
  const { data: session, isPending } = authClient.useSession();
  const router = useRouter();
  const [history, setHistory] = useState<HealthCheck[]>([]);
  const [stats, setStats] = useState<{ successCount: number; totalCount: number } | null>(null);
  const [latest, setLatest] = useState<HealthCheck | null>(null);
  const [loading, setLoading] = useState(false);
  const [nextCheckAt, setNextCheckAt] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [probing, setProbing] = useState(false); // true when waiting for backend probe to finish
  const [initialLoading, setInitialLoading] = useState(true);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [activeBarIndex, setActiveBarIndex] = useState<number | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const lastCheckIdRef = useRef<number | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const barContainerRef = useRef<HTMLDivElement>(null);
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isPending && !session) {
      router.push("/login");
    }
  }, [isPending, session, router]);

  const fetchData = useCallback(async () => {
    // 取消正在进行的 poll
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    setProbing(false);
    setLoading(true);
    try {
      const res = await fetch(`/api/health/history?limit=${CLIENT_RUNTIME_POLICY.healthHistoryLimit}`);
      if (res.ok) {
        const data: HistoryData = await res.json();
        setHistory(data.history);
        setStats(data.stats);
        if (data.history.length > 0) {
          setLatest(data.history[0]);
          lastCheckIdRef.current = data.history[0].id;
        }
        if (data.nextCheckAt) {
          setNextCheckAt(new Date(data.nextCheckAt));
        }
      }
    } catch (error) {
      console.error("获取健康检查数据失败:", error);
    } finally {
      setInitialLoading(false);
      setLoading(false);
    }
  }, []);

  // Poll for new result after nextCheckAt arrives (backend may still be probing)
  const waitForNewResult = useCallback(async () => {
    setProbing(true);
    const maxAttempts = CLIENT_RUNTIME_POLICY.healthResultPollAttempts;
    let attempt = 0;

    const poll = async () => {
      attempt++;
      try {
        const res = await fetch(`/api/health/history?limit=${CLIENT_RUNTIME_POLICY.healthLatestLimit}`);
        if (res.ok) {
          const data: HistoryData = await res.json();
          if (data.history.length > 0 && data.history[0].id !== lastCheckIdRef.current) {
            // New record found — full refresh
            setProbing(false);
            fetchData();
            return;
          }
        }
      } catch { /* ignore */ }

      if (attempt < maxAttempts) {
        pollRef.current = setTimeout(poll, CLIENT_RUNTIME_POLICY.healthResultPollMs);
      } else {
        // Give up waiting, just refresh whatever we have
        setProbing(false);
        fetchData();
      }
    };

    poll();
  }, [fetchData]);

  // Initial load
  useEffect(() => {
    if (!session) return;

    const timeoutId = window.setTimeout(() => {
      void fetchData();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [session, fetchData]);

  // Countdown based on server's nextCheckAt
  useEffect(() => {
    countdownRef.current = setInterval(() => {
      if (nextCheckAt && !probing) {
        const remaining = Math.max(0, Math.round((nextCheckAt.getTime() - Date.now()) / 1000));
        setCountdown(remaining);
        if (remaining === 0) {
          setNextCheckAt(null);
          setCountdown(null);
          waitForNewResult();
        }
      }
    }, CLIENT_RUNTIME_POLICY.healthCountdownTickMs);

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [nextCheckAt, probing, waitForNewResult]);

  // Cleanup poll on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  // Position tooltip aligned to the actual bar element
  useEffect(() => {
    const tip = tooltipRef.current;
    const container = barContainerRef.current;
    if (!tip || !container || hoveredIndex === null) return;
    // Get the actual bar element's position (offsetLeft is relative to the positioned container)
    const bar = container.querySelector<HTMLElement>(`.flex > :nth-child(${hoveredIndex + 1})`);
    if (!bar) return;
    const barCenter = bar.offsetLeft + bar.offsetWidth / 2;
    tip.style.left = `${barCenter}px`;
    tip.style.right = "auto";
    tip.style.transform = "translateX(-50%)";
    // Check overflow after paint
    requestAnimationFrame(() => {
      const rect = tip.getBoundingClientRect();
      if (rect.left < 8) {
        tip.style.left = "0";
        tip.style.transform = "translateX(0)";
      } else if (rect.right > window.innerWidth - 8) {
        tip.style.left = "auto";
        tip.style.right = "0";
        tip.style.transform = "translateX(0)";
      }
    });
  }, [hoveredIndex]);

  if (isPending) {
    return (
      <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center">
        <div className="animate-pulse text-slate-400">{t("loading")}</div>
      </div>
    );
  }

  if (!session) return null;

  const overallStatus = latest?.status === "success" ? t("operational") : latest?.status === "error" ? t("degraded") : t("checking");
  const statusColor = latest?.status === "success" ? "text-emerald-400" : latest?.status === "error" ? "text-red-400" : "text-slate-400";
  const statusBgColor = latest?.status === "success" ? "bg-emerald-500/15 border-emerald-500/30" : latest?.status === "error" ? "bg-red-500/15 border-red-500/30" : "bg-slate-500/15 border-slate-500/30";
  const availabilityPct = stats && stats.totalCount > 0 ? ((stats.successCount / stats.totalCount) * 100).toFixed(2) : "—";
  const availabilityColor = stats && stats.totalCount > 0
    ? (stats.successCount / stats.totalCount) >= 0.9 ? "text-emerald-400"
      : (stats.successCount / stats.totalCount) >= 0.5 ? "text-amber-400"
        : "text-red-400"
    : "text-slate-400";

  // History bars follow the deployment-configured history window and are padded on the left (oldest→newest).
  const totalBars = CLIENT_RUNTIME_POLICY.healthHistoryLimit;
  const reversed = [...history].reverse();
  const historyBars: (HealthCheck | null)[] = [
    ...Array<null>(Math.max(0, totalBars - reversed.length)).fill(null),
    ...reversed,
  ];

  return (
    <div className="min-h-screen bg-[#0a0f1a] overflow-x-hidden">
      {/* Ambient glow */}
      <div className="fixed top-0 left-1/2 w-screen max-w-[600px] h-[400px] -translate-x-1/2 bg-gradient-radial from-cyan-500/5 via-blue-500/3 to-transparent rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <header className="border-b border-white/[0.06] bg-[#0a0f1a]/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-2">
          <Link href="/" className="whitespace-nowrap" aria-label="LCE">
            <LceBrand iconSize={32} textClassName="text-lg sm:text-xl" priority />
          </Link>
          <nav className="order-3 grid w-full grid-cols-3 sm:order-none sm:flex sm:w-auto sm:items-center sm:gap-1">
            <Link
              href="/console"
              className="px-2 sm:px-3 py-1.5 text-center text-xs sm:text-sm whitespace-nowrap text-slate-400 hover:text-slate-200 border-b-2 border-transparent transition-colors"
            >
              {t("console")}
            </Link>
            <Link
              href="/leaderboard"
              className="px-2 sm:px-3 py-1.5 text-center text-xs sm:text-sm whitespace-nowrap text-slate-400 hover:text-slate-200 border-b-2 border-transparent transition-colors"
            >
              {t("leaderboard")}
            </Link>
            <Link
              href="/status"
              className="px-2 sm:px-3 py-1.5 text-center text-xs sm:text-sm whitespace-nowrap text-white border-b-2 border-cyan-400"
            >
              {t("status")}
            </Link>
          </nav>
          <div className="flex items-center gap-1.5">
            <LanguageSwitcher />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fetchData()}
              disabled={loading}
              className="text-slate-400 hover:text-white"
              aria-label={t("refreshStatus")}
              title={t("refreshStatus")}
            >
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            </Button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        {initialLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full bg-white/[0.06] rounded-xl" />
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-24 bg-white/[0.06] rounded-xl" />
              <Skeleton className="h-24 bg-white/[0.06] rounded-xl" />
            </div>
            <Skeleton className="h-32 w-full bg-white/[0.06] rounded-xl" />
            <Skeleton className="h-24 w-full bg-white/[0.06] rounded-xl" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Service identity + status badge */}
            <div className="rounded-xl border border-white/[0.06] bg-[#0d1424]/60 backdrop-blur-xl p-6">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                  <LceBrand
                    iconSize={56}
                    showName={false}
                    iconClassName="w-11 h-11 sm:w-14 sm:h-14"
                  />
                  <div className="min-w-0">
                    <h1 className="text-lg sm:text-xl font-semibold text-white">LCE</h1>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs px-2 py-0.5 rounded-md bg-white/[0.06] text-slate-400 shrink-0">
                        LCE
                      </span>
                      <span className="text-sm text-slate-500 font-mono truncate">
                        code-context-engine
                      </span>
                    </div>
                  </div>
                </div>
                <span className={cn(
                  "text-sm font-medium px-3 py-1 rounded-lg border whitespace-nowrap shrink-0",
                  statusBgColor, statusColor
                )}>
                  {overallStatus}
                </span>
              </div>
            </div>

            {/* Latency cards */}
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl border border-white/[0.06] bg-[#0d1424]/60 backdrop-blur-xl p-5">
                <div className="flex items-center gap-2 text-slate-400 mb-3">
                  <Zap className="w-4 h-4" />
                  <span className="text-sm">{t("requestLatency")}</span>
                </div>
                <div className="text-3xl font-semibold text-white font-mono">
                  {latest?.codebaseRetrievalMs != null ? (
                    <>
                      {latest.codebaseRetrievalMs.toLocaleString()}
                      <span className="text-base text-slate-400 ml-2">ms</span>
                    </>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-[#0d1424]/60 backdrop-blur-xl p-5">
                <div className="flex items-center gap-2 text-slate-400 mb-3">
                  <Radio className="w-4 h-4" />
                  <span className="text-sm">{t("endpointPing")}</span>
                </div>
                <div className="text-3xl font-semibold text-white font-mono">
                  {latest?.tcpPingMs != null ? (
                    <>
                      {latest.tcpPingMs.toLocaleString()}
                      <span className="text-base text-slate-400 ml-2">ms</span>
                    </>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </div>
              </div>
            </div>

            {/* Status + Availability */}
            <div className="rounded-xl border border-white/[0.06] bg-[#0d1424]/60 backdrop-blur-xl p-6">
              <div className="flex items-center justify-between mb-5">
                <span className="text-sm text-slate-400">{t("upstreamStatus")}</span>
                <span className={cn("text-sm font-medium", statusColor)}>
                  {overallStatus}
                </span>
              </div>
              <div className="border-t border-white/[0.04] pt-4">
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-sm text-slate-400 mb-1">{t("availability7Days")}</div>
                    <div className="text-sm text-slate-500">
                      {stats ? `${stats.successCount}/${stats.totalCount} ${t("successful")}` : "—"}
                    </div>
                  </div>
                  <div className={cn("text-2xl font-semibold font-mono", availabilityColor)}>
                    {availabilityPct}{stats && stats.totalCount > 0 ? "%" : ""}
                  </div>
                </div>
              </div>
            </div>

            {/* History bars */}
            <div className="rounded-xl border border-white/[0.06] bg-[#0d1424]/60 backdrop-blur-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-semibold tracking-normal sm:tracking-wider text-slate-400 uppercase whitespace-nowrap">
                  {t("history60Checks")}
                </span>
                <div className="flex items-center gap-1.5 text-[11px] sm:text-xs text-slate-500 whitespace-nowrap ml-3">
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  <span className="uppercase font-medium">
                    {probing ? t("checking2") : countdown != null ? t("nextInS", {p0: countdown}) : t("waiting")}
                  </span>
                  {probing && (
                    <RefreshCw className="w-3 h-3 animate-spin text-cyan-400 ml-1" />
                  )}
                </div>
              </div>

              {/* Bar chart */}
              <div ref={barContainerRef} className="relative mb-3">
                <div className="flex items-end gap-[2px] sm:gap-[3px] h-10">
                  {historyBars.map((check, i) => {
                    const isSuccess = check?.status === "success";
                    const totalMs = check ? (check.codebaseRetrievalMs || 0) + (check.tcpPingMs || 0) : 0;
                    const isSlow = isSuccess && totalMs > CLIENT_RUNTIME_POLICY.healthSlowThresholdMs;

                    return (
                      <div
                        key={check?.id || `empty-${i}`}
                        className={cn(
                          "flex-1 min-w-0 max-w-[12px] h-full rounded-sm transition-all cursor-pointer",
                          check
                            ? isSuccess
                              ? isSlow ? "bg-amber-500" : "bg-emerald-500"
                              : "bg-red-500"
                            : "bg-slate-700",
                          activeBarIndex === i && "brightness-125",
                          hoveredIndex === i && "scale-x-110"
                        )}
                        onMouseEnter={() => {
                          setActiveBarIndex(i);
                          if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
                          hoverTimerRef.current = setTimeout(() => setHoveredIndex(i), CLIENT_RUNTIME_POLICY.hoverIntentMs);
                        }}
                        onMouseLeave={() => {
                          setActiveBarIndex(null);
                          if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
                          hoverTimerRef.current = null;
                          setHoveredIndex(null);
                        }}
                      />
                    );
                  })}
                </div>

                {/* Tooltip */}
                {(() => {
                  const check = hoveredIndex !== null ? historyBars[hoveredIndex] : null;
                  const isSuccess = check?.status === "success";
                  return (
                    <div
                      ref={tooltipRef}
                      className={cn(
                        "absolute bottom-full mb-2 z-50",
                        "bg-[#1a2235] border border-white/[0.1] rounded-lg shadow-xl p-3",
                        "pointer-events-none",
                        "transition-[opacity,translate] duration-150 ease-out",
                        hoveredIndex !== null
                          ? "opacity-100 translate-y-0"
                          : "opacity-0 translate-y-1",
                        check ? "w-56" : "w-auto"
                      )}
                    >
                      {hoveredIndex !== null && (
                        check ? (
                          <>
                            <div className="flex items-center justify-between mb-2">
                              <span className={cn(
                                "text-xs font-medium px-2 py-0.5 rounded",
                                isSuccess
                                  ? "bg-emerald-500/15 text-emerald-400"
                                  : "bg-red-500/15 text-red-400"
                              )}>
                                {isSuccess ? t("operational") : t("degraded")}
                              </span>
                              <span className="text-[11px] text-slate-500 font-mono">
                                {new Date(check.createdAt).toLocaleString(locale)}
                              </span>
                            </div>
                            <div className="border-t border-white/[0.06] pt-2 space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-slate-400">Latency</span>
                                <span className="text-xs text-white font-mono font-medium">
                                  {check.codebaseRetrievalMs != null ? `${check.codebaseRetrievalMs.toLocaleString()} ms` : "—"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-slate-400">Ping</span>
                                <span className="text-xs text-white font-mono font-medium">
                                  {check.tcpPingMs != null ? `${check.tcpPingMs.toLocaleString()} ms` : "—"}
                                </span>
                              </div>
                            </div>
                            <div className="border-t border-white/[0.06] mt-2 pt-2">
                              <span className="text-[11px] text-slate-500">
                                {isSuccess
                                  ? t("checkPassed", {p0: check.codebaseRetrievalMs != null ? ` (${check.codebaseRetrievalMs.toLocaleString()}ms)` : ""})
                                  : check.errorMessage || t("checkFailed")}
                              </span>
                            </div>
                          </>
                        ) : (
                          <div className="text-xs text-slate-500 text-center whitespace-nowrap">{t("noData")}</div>
                        )
                      )}
                    </div>
                  );
                })()}
              </div>

              <div className="flex items-center justify-between text-[10px] text-slate-600 uppercase tracking-wider">
                <span>{t("past")}</span>
                <span>{t("now")}</span>
              </div>
            </div>

            {/* Error message (if any) */}
            {latest?.status === "error" && latest.errorMessage && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
                <div className="text-xs text-red-400 font-medium mb-1">{t("latestError")}</div>
                <div className="text-sm text-red-300/80 font-mono">
                  {latest.errorMessage}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
