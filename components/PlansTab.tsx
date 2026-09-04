"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clock3, CreditCard, Loader2, RefreshCw, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "next-intl";
import { formatByteLimit, formatBytes } from "@/lib/byte-units";

interface BillingPlan {
  id: string;
  code: string;
  name: string;
  description: string;
  tier: "free" | "pro";
  priceFen: number;
  durationDays: number;
  dailyRequestLimit: number;
  dailyIndexBytesLimit: number;
  subaccountLimit: number;
}

interface Subscription {
  planId: string;
  planName: string;
  tier: "free" | "pro";
  dailyRequestLimit: number;
  dailyIndexBytesLimit: number;
  subaccountLimit: number;
  startsAt: string;
  expiresAt: string;
}

interface BillingOrder {
  orderNo: string;
  provider: "alipay" | "wechat";
  status: "pending" | "paid" | "closed" | "canceled" | "failed";
  fulfillmentStatus: "pending" | "applied" | "manual_review";
  fulfillmentError: string | null;
  amountFen: number;
  codeUrl: string | null;
  expiresAt: string;
  createdAt: string;
  planSnapshot: { name: string };
}

interface BillingOverview {
  plans: BillingPlan[];
  subscription: Subscription | null;
  orders: BillingOrder[];
  seats: { used: number; limit: number };
  usage: {
    available: boolean;
    requestsUsed: number | null;
    indexBytesUsed: number | null;
    resetAt: string;
  };
  providers: { alipay: boolean; wechat: boolean };
  purchaseOptions?: Record<string, {
    allowed: boolean;
    kind: "new" | "renewal" | "upgrade" | "downgrade" | "upgrade_term_too_short";
    reason?: string;
  }>;
}

interface CheckoutState {
  order: BillingOrder;
  qrCodeDataUrl: string;
}

type NoticeState = {
  message: string;
  tone: "success" | "warning" | "error";
};

function formatLimit(value: number, unit: string, unlimited: string): string {
  return value === 0
    ? unlimited
    : `${value.toLocaleString()}${unit ? ` ${unit}` : ""}`;
}

function formatMoney(fen: number): string {
  return `¥${(fen / 100).toFixed(2)}`;
}

function quotaPercent(used: number | null, limit: number | undefined): number {
  if (used === null || !limit || limit <= 0) return 0;
  return Math.min(100, Math.max(0, (used / limit) * 100));
}

function quotaTone(percent: number): string {
  if (percent >= 100) return "bg-red-400";
  if (percent >= 80) return "bg-amber-400";
  return "bg-cyan-400";
}

export function PlansTab() {
  const locale = useLocale();
  const t = useTranslations("Billing");
  const [data, setData] = useState<BillingOverview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [checkout, setCheckout] = useState<CheckoutState | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/billing", { signal });
    const payload = (await response.json().catch(() => ({}))) as
      | BillingOverview
      | { error?: string };
    if (!response.ok) {
      throw new Error("error" in payload ? payload.error : t("failedToLoadPlans"));
    }
    if (signal?.aborted) return;
    setData(payload as BillingOverview);
    setError("");
  }, [t]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve()
      .then(() => load(controller.signal))
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : t("failedToLoadPlans"));
        }
      });
    return () => controller.abort();
  }, [load, t]);

  useEffect(() => {
    if (!checkout || checkout.order.status !== "pending") return;
    let stopped = false;
    const poll = async () => {
      try {
        const response = await fetch(
          `/api/billing/orders/${encodeURIComponent(checkout.order.orderNo)}`,
          { cache: "no-store" }
        );
        const payload = (await response.json().catch(() => ({}))) as {
          order?: BillingOrder;
        };
        if (stopped || !response.ok || !payload.order) return;
        if (payload.order.status === "paid") {
          setCheckout(null);
          setNotice({
            message:
              payload.order.fulfillmentStatus === "applied"
                ? t("paymentCompletedPlanBenefitsAreActive")
                : t("paymentReceivedNeedsManualReview"),
            tone:
              payload.order.fulfillmentStatus === "applied"
                ? "success"
                : "warning",
          });
          await load();
        } else if (
          payload.order.status === "closed" ||
          payload.order.status === "canceled" ||
          payload.order.status === "failed"
        ) {
          setCheckout((current) =>
            current ? { ...current, order: payload.order! } : current
          );
        }
      } catch {
        // 短暂网络失败不终止支付轮询。
      }
    };
    const timer = window.setInterval(() => void poll(), 2_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [checkout, load, t]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("failedToLoadPlans"));
    } finally {
      setLoading(false);
    }
  }, [load, t]);

  const startCheckout = useCallback(
    async (plan: BillingPlan, provider: "alipay" | "wechat") => {
      setBusy(`${plan.id}:${provider}`);
      setNotice(null);
      try {
        const response = await fetch("/api/billing/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planId: plan.id, provider }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          order?: BillingOrder;
          qrCodeDataUrl?: string;
        };
        if (!response.ok || !payload.order || !payload.qrCodeDataUrl) {
          throw new Error(payload.error || t("failedToCreatePaymentOrder"));
        }
        setCheckout({
          order: payload.order,
          qrCodeDataUrl: payload.qrCodeDataUrl,
        });
      } catch (reason) {
        setNotice({
          message: reason instanceof Error ? reason.message : t("failedToCreatePaymentOrder"),
          tone: "error",
        });
      } finally {
        setBusy("");
      }
    },
    [t]
  );

  const cancelOrder = useCallback(async (orderNo: string) => {
    setBusy(`cancel:${orderNo}`);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/billing/orders/${encodeURIComponent(orderNo)}`,
        { method: "DELETE" }
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        order?: BillingOrder;
      };
      if (!response.ok || !payload.order) {
        throw new Error(payload.error || t("failedToCancelOrder"));
      }
      setCheckout((current) =>
        current?.order.orderNo === orderNo ? null : current
      );
      setNotice({ message: t("pendingOrderCanceled"), tone: "success" });
      await load();
    } catch (reason) {
      setNotice({
        message: reason instanceof Error ? reason.message : t("failedToCancelOrder"),
        tone: "error",
      });
    } finally {
      setBusy("");
    }
  }, [load, t]);

  const recentOrders = useMemo(() => data?.orders.slice(0, 5) ?? [], [data]);
  const requestPercent = quotaPercent(
    data?.usage.requestsUsed ?? null,
    data?.subscription?.dailyRequestLimit
  );
  const indexPercent = quotaPercent(
    data?.usage.indexBytesUsed ?? null,
    data?.subscription?.dailyIndexBytesLimit
  );

  if (!data && !error) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 rounded-xl bg-white/[0.06]" />
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-72 rounded-xl bg-white/[0.06]" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <p className="text-sm text-red-400">{error}</p>
        <Button variant="glass" size="sm" onClick={refresh}>
          {t("retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-cyan-500/15 bg-cyan-500/[0.035]">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm text-slate-400">{t("currentPlan")}</p>
                <Badge variant="outline" className="border-cyan-500/25 text-cyan-300">
                  {data.subscription?.tier === "pro" ? "Pro" : "Free"}
                </Badge>
              </div>
              <p className="mt-2 text-xl font-semibold text-white">
                {data.subscription?.planName || t("freePlan")}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {data.subscription
                  ? t("validUntil", {p0: new Date(data.subscription.expiresAt).toLocaleString(locale)})
                  : t("noActivePaidSubscription")}
              </p>
            </div>
            <div className="grid min-w-[280px] grid-cols-3 gap-3 text-xs">
              <div>
                <p className="text-slate-500">{t("requestsDay")}</p>
                <p className="mt-1 font-mono text-slate-200">
                  {data.subscription
                    ? formatLimit(data.subscription.dailyRequestLimit, "", t("unlimited"))
                    : t("platformDefault")}
                </p>
              </div>
              <div>
                <p className="text-slate-500">{t("indexDay")}</p>
                <p className="mt-1 font-mono text-slate-200">
                  {data.subscription
                    ? formatByteLimit(data.subscription.dailyIndexBytesLimit, t("unlimited"))
                    : t("platformDefault")}
                </p>
              </div>
              <div>
                <p className="text-slate-500">{t("subaccounts")}</p>
                <p className="mt-1 font-mono text-slate-200">
                  {data.seats.used} / {data.seats.limit}
                </p>
              </div>
            </div>
          </div>
          <div className="mt-5 grid gap-4 border-t border-white/[0.06] pt-4 md:grid-cols-2">
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-slate-400">{t("requestsUsedToday")}</span>
                <span className="font-mono text-slate-200">
                  {data.usage.requestsUsed === null
                    ? t("usageTemporarilyUnavailable")
                    : data.subscription
                      ? `${data.usage.requestsUsed.toLocaleString()} / ${formatLimit(data.subscription.dailyRequestLimit, "", t("unlimited"))}`
                      : data.usage.requestsUsed.toLocaleString()}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className={cn("h-full rounded-full transition-[width]", quotaTone(requestPercent))}
                  style={{ width: `${requestPercent}%` }}
                />
              </div>
            </div>
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-slate-400">{t("indexUsedToday")}</span>
                <span className="font-mono text-slate-200">
                  {data.usage.indexBytesUsed === null
                    ? t("usageTemporarilyUnavailable")
                    : data.subscription
                      ? `${formatBytes(data.usage.indexBytesUsed)} / ${formatByteLimit(data.subscription.dailyIndexBytesLimit, t("unlimited"))}`
                      : formatBytes(data.usage.indexBytesUsed)}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className={cn("h-full rounded-full transition-[width]", quotaTone(indexPercent))}
                  style={{ width: `${indexPercent}%` }}
                />
              </div>
            </div>
          </div>
          <p className="mt-3 text-right text-[11px] text-slate-600">
            {t("quotaResetsAt", { p0: new Date(data.usage.resetAt).toLocaleString(locale) })}
          </p>
        </CardContent>
      </Card>

      <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-3 text-xs leading-5 text-slate-500">
        <p>{t("subscriptionLifecyclePolicy")}</p>
        <p className="mt-1">{t("subaccountQuotaPolicy")}</p>
        <p className="mt-1">{t("activeSubscriptionCancellationPolicy")}</p>
      </div>

      {notice && (
        <p
          className={cn(
            "text-sm",
            notice.tone === "success"
              ? "text-emerald-400"
              : notice.tone === "warning"
                ? "text-amber-400"
                : "text-red-400"
          )}
        >
          {notice.message}
        </p>
      )}

      {data.plans.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/[0.1] px-6 py-12 text-center">
          <CreditCard className="mx-auto h-8 w-8 text-slate-600" />
          <p className="mt-3 text-sm text-slate-400">{t("noPlansAvailable")}</p>
          <p className="mt-1 text-xs text-slate-600">{t("plansAppearHereAfterAnAdministratorPublishes")}</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {data.plans.map((plan) => (
            <Card
              key={plan.id}
              className={cn(
                "relative overflow-hidden bg-[#0a0f1a]/70",
                data.subscription?.planId === plan.id
                  ? "border-cyan-500/35"
                  : "border-white/[0.07]"
              )}
            >
              <CardContent className="flex h-full flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-white">{plan.name}</p>
                    <p className="mt-1 min-h-10 text-xs leading-5 text-slate-500">
                      {plan.description || "—"}
                    </p>
                  </div>
                  {data.subscription?.planId === plan.id && (
                    <Badge className="border-cyan-500/20 bg-cyan-500/10 text-cyan-300">
                      {t("current")}
                    </Badge>
                  )}
                </div>
                <div className="mt-5 flex items-end gap-2">
                  <span className="text-3xl font-semibold text-white">
                    {formatMoney(plan.priceFen)}
                  </span>
                  <span className="pb-1 text-xs text-slate-500">
                    / {plan.durationDays} {t("days")}
                  </span>
                </div>
                <p className={cn(
                  "mt-2 text-xs",
                  data.purchaseOptions?.[plan.id]?.allowed === false
                    ? "text-amber-400"
                    : "text-cyan-400"
                )}>
                  {data.purchaseOptions?.[plan.id]?.allowed === false
                    ? data.purchaseOptions[plan.id]?.kind === "upgrade_term_too_short"
                      ? t("upgradeTermTooShort")
                      : t("downgradeUnavailable")
                    : t(`purchaseKind.${data.purchaseOptions?.[plan.id]?.kind ?? "new"}`)}
                </p>
                <div className="mt-5 space-y-3 text-sm">
                  <div className="flex items-center gap-2 text-slate-300">
                    <Check className="h-4 w-4 text-cyan-400" />
                    {t("dailyRequests")} {formatLimit(plan.dailyRequestLimit, t("requests"), t("unlimited"))}
                  </div>
                  <div className="flex items-center gap-2 text-slate-300">
                    <Check className="h-4 w-4 text-cyan-400" />
                    {t("dailyIndex")} {formatByteLimit(plan.dailyIndexBytesLimit, t("unlimited"))}
                  </div>
                  <div className="flex items-center gap-2 text-slate-300">
                    <Users className="h-4 w-4 text-cyan-400" />
                    {plan.subaccountLimit} {t("subaccounts2")}
                  </div>
                </div>
                <div className="mt-6 grid grid-cols-2 gap-2">
                  <Button
                    variant="glass"
                    size="sm"
                    disabled={
                      plan.priceFen <= 0 ||
                      data.purchaseOptions?.[plan.id]?.allowed === false ||
                      !data.providers.alipay ||
                      busy === `${plan.id}:alipay`
                    }
                    onClick={() => startCheckout(plan, "alipay")}
                  >
                    {busy === `${plan.id}:alipay` && (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    )}
                    {t("alipay")}
                  </Button>
                  <Button
                    variant="glass"
                    size="sm"
                    disabled={
                      plan.priceFen <= 0 ||
                      data.purchaseOptions?.[plan.id]?.allowed === false ||
                      !data.providers.wechat ||
                      busy === `${plan.id}:wechat`
                    }
                    onClick={() => startCheckout(plan, "wechat")}
                  >
                    {busy === `${plan.id}:wechat` && (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    )}
                    {t("wechatPay")}
                  </Button>
                </div>
                {data.purchaseOptions?.[plan.id]?.allowed === false ? (
                  <p className="mt-2 text-[10px] text-amber-500/80">
                    {data.purchaseOptions[plan.id]?.kind === "upgrade_term_too_short"
                      ? t("upgradeTermTooShortHelp")
                      : t("downgradeContactSupport")}
                  </p>
                ) : plan.priceFen <= 0 ? (
                  <p className="mt-2 text-[10px] text-slate-600">
                    {t("freeAndInternalPlansMustBeAssigned")}
                  </p>
                ) : (!data.providers.alipay || !data.providers.wechat) && (
                  <p className="mt-2 text-[10px] text-slate-600">
                    {t("disabledPaymentMethodsHaveNotBeenConfigured")}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {checkout && (
        <Card className="border-cyan-500/25 bg-[#0a0f1a]">
          <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
            <div>
              <p className="font-medium text-white">
                {checkout.order.provider === "alipay" ? t("alipay") : t("wechat")} {t("qrPayment")}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {checkout.order.planSnapshot.name} · {formatMoney(checkout.order.amountFen)}
              </p>
            </div>
            <div className="rounded-xl bg-white p-3">
              <Image
                src={checkout.qrCodeDataUrl}
                width={224}
                height={224}
                unoptimized
                alt={t("paymentQrCode")}
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              {checkout.order.status === "pending" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
                  {t("waitingForPayment")}
                </>
              ) : (
                <>
                  <Clock3 className="h-4 w-4" />
                  {t(`orderStatus.${checkout.order.status}`)}
                </>
              )}
            </div>
            <p className="text-[11px] text-slate-600">{t("closingQrDoesNotCancel")}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {checkout.order.status === "pending" && (
                <Button
                  variant="glass"
                  size="sm"
                  disabled={
                    busy === `cancel:${checkout.order.orderNo}` ||
                    !checkout.order.codeUrl
                  }
                  title={
                    checkout.order.codeUrl
                      ? undefined
                      : t("providerOrderBeingCreated")
                  }
                  onClick={() => void cancelOrder(checkout.order.orderNo)}
                  className="text-amber-300"
                >
                  {busy === `cancel:${checkout.order.orderNo}` && (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  )}
                  {t("cancelPendingOrder")}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setCheckout(null)}>
                {t("close")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {recentOrders.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">{t("recentOrders")}</h3>
            <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
          <div className="divide-y divide-white/[0.05] rounded-xl border border-white/[0.07]">
            {recentOrders.map((order) => (
              <div
                key={order.orderNo}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-xs"
              >
                <span className="min-w-28 text-slate-300">
                  {order.planSnapshot.name}
                </span>
                <span className="font-mono text-slate-500">
                  {formatMoney(order.amountFen)}
                </span>
                <span className="text-slate-500">
                  {order.provider === "alipay" ? t("alipay") : t("wechat")}
                </span>
                <span
                  className={cn(
                    "ml-auto",
                    order.status === "paid" && order.fulfillmentStatus === "applied"
                      ? "text-emerald-400"
                      : order.status === "pending" || order.fulfillmentStatus === "manual_review"
                        ? "text-amber-400"
                        : "text-slate-600"
                  )}
                  title={order.fulfillmentError || undefined}
                >
                  {order.status === "paid" && order.fulfillmentStatus === "manual_review"
                    ? t("orderNeedsManualReview")
                    : t(`orderStatus.${order.status}`)}
                </span>
                {order.status === "pending" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={
                      busy === `cancel:${order.orderNo}` || !order.codeUrl
                    }
                    title={
                      order.codeUrl ? undefined : t("providerOrderBeingCreated")
                    }
                    onClick={() => void cancelOrder(order.orderNo)}
                    className="h-7 px-2 text-[11px] text-amber-300"
                  >
                    {busy === `cancel:${order.orderNo}`
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : t("cancel")}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
