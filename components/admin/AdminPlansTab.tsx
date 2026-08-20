"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

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
  active: boolean;
  sortOrder: number;
}

interface PlanDraft {
  id?: string;
  code: string;
  name: string;
  description: string;
  tier: "free" | "pro";
  priceYuan: string;
  durationDays: string;
  dailyRequestLimit: string;
  dailyIndexBytesLimit: string;
  subaccountLimit: string;
  sortOrder: string;
  active: boolean;
}

const EMPTY_DRAFT: PlanDraft = {
  code: "",
  name: "",
  description: "",
  tier: "pro",
  priceYuan: "",
  durationDays: "30",
  dailyRequestLimit: "0",
  dailyIndexBytesLimit: "0",
  subaccountLimit: "0",
  sortOrder: "0",
  active: true,
};

function formatBytes(value: number, unlimited: string): string {
  if (value === 0) return unlimited;
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let current = value;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current.toFixed(current >= 10 || Number.isInteger(current) ? 0 : 1)} ${units[index]}`;
}

function parseInteger(value: string, invalidMessage: string, rangeMessage: string): number {
  if (!/^\d+$/.test(value.trim())) throw new Error(invalidMessage);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(rangeMessage);
  return parsed;
}

function yuanToFen(value: string, formatMessage: string, rangeMessage: string): number {
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error(formatMessage);
  const result =
    BigInt(match[1]) * BigInt(100) +
    BigInt((match[2] || "").padEnd(2, "0"));
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(rangeMessage);
  }
  return Number(result);
}

export function AdminPlansTab() {
  const t = useTranslations("AdminPlans");
  const [plans, setPlans] = useState<BillingPlan[] | null>(null);
  const [draft, setDraft] = useState<PlanDraft>(EMPTY_DRAFT);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeOk, setNoticeOk] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/admin/plans", { signal });
    const payload = (await response.json().catch(() => ({}))) as {
      plans?: BillingPlan[];
      error?: string;
    };
    if (!response.ok || !payload.plans) {
      throw new Error(payload.error || t("failedToLoadPlans"));
    }
    if (!signal?.aborted) {
      setPlans(payload.plans);
      setError("");
    }
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

  const edit = (plan: BillingPlan) => {
    setDraft({
      id: plan.id,
      code: plan.code,
      name: plan.name,
      description: plan.description,
      tier: plan.tier,
      priceYuan: (plan.priceFen / 100).toFixed(2),
      durationDays: String(plan.durationDays),
      dailyRequestLimit: String(plan.dailyRequestLimit),
      dailyIndexBytesLimit: String(plan.dailyIndexBytesLimit),
      subaccountLimit: String(plan.subaccountLimit),
      sortOrder: String(plan.sortOrder),
      active: plan.active,
    });
    setNotice("");
  };

  const save = async () => {
    setBusy(true);
    setNotice("");
    try {
      const body = {
        id: draft.id,
        code: draft.code.trim(),
        name: draft.name.trim(),
        description: draft.description.trim(),
        tier: draft.tier,
        priceFen: yuanToFen(draft.priceYuan, t("priceFormat"), t("priceOutOfRange")),
        durationDays: parseInteger(draft.durationDays, t("mustBeNonNegativeInteger", { label: t("durationDays") }), t("outOfRange", { label: t("durationDays") })),
        dailyRequestLimit: parseInteger(draft.dailyRequestLimit, t("mustBeNonNegativeInteger", { label: t("dailyRequests") }), t("outOfRange", { label: t("dailyRequests") })),
        dailyIndexBytesLimit: parseInteger(
          draft.dailyIndexBytesLimit,
          t("mustBeNonNegativeInteger", { label: t("dailyIndexBytes") }),
          t("outOfRange", { label: t("dailyIndexBytes") })
        ),
        subaccountLimit: parseInteger(draft.subaccountLimit, t("mustBeNonNegativeInteger", { label: t("subaccounts") }), t("outOfRange", { label: t("subaccounts") })),
        sortOrder: parseInteger(draft.sortOrder, t("mustBeNonNegativeInteger", { label: t("sortOrder") }), t("outOfRange", { label: t("sortOrder") })),
        active: draft.active,
      };
      if (!body.code || !body.name || body.durationDays <= 0) {
        throw new Error(t("completeRequiredFields"));
      }
      const response = await fetch("/api/admin/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || t("failedToSave"));
      await load();
      setDraft(EMPTY_DRAFT);
      setNotice(t("planSaved"));
      setNoticeOk(true);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : t("failedToSave"));
      setNoticeOk(false);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (plan: BillingPlan) => {
    if (!window.confirm(t("confirmDeletePlan", { name: plan.name }))) {
      return;
    }
    setNotice("");
    try {
      const response = await fetch(
        `/api/admin/plans/${encodeURIComponent(plan.id)}`,
        { method: "DELETE" }
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || t("failedToDelete"));
      await load();
      setNotice(t("planDeleted"));
      setNoticeOk(true);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : t("failedToDelete"));
      setNoticeOk(false);
    }
  };

  if (!plans && !error) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-16 rounded-xl bg-white/[0.06]" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-white/[0.07] bg-[#0a0f1a]/70">
        <CardContent className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-white">
                {draft.id ? t("editPlan") : t("newPlan")}
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                {t("snapshotDescription")}
              </p>
            </div>
            {draft.id && (
              <Button variant="ghost" size="sm" onClick={() => setDraft(EMPTY_DRAFT)}>
                <Plus className="mr-1 h-4 w-4" />
                {t("new")}
              </Button>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Field label={t("planCode")}>
              <input
                value={draft.code}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, code: event.target.value }))
                }
                placeholder="pro-monthly"
                className="field-input"
              />
            </Field>
            <Field label={t("planName")}>
              <input
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
                placeholder={t("planNamePlaceholder")}
                className="field-input"
              />
            </Field>
            <Field label={t("tier")}>
              <select
                value={draft.tier}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    tier: event.target.value === "free" ? "free" : "pro",
                  }))
                }
                className="field-input"
              >
                <option value="free">Free</option>
                <option value="pro">Pro</option>
              </select>
            </Field>
            <Field label={t("priceYuan")}>
              <input
                value={draft.priceYuan}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    priceYuan: event.target.value,
                  }))
                }
                inputMode="decimal"
                placeholder="29.90"
                className="field-input"
              />
            </Field>
            <Field label={t("durationDays")}>
              <input
                value={draft.durationDays}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    durationDays: event.target.value,
                  }))
                }
                inputMode="numeric"
                className="field-input"
              />
            </Field>
            <Field label={t("dailyRequests")}>
              <input
                value={draft.dailyRequestLimit}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    dailyRequestLimit: event.target.value,
                  }))
                }
                inputMode="numeric"
                className="field-input"
              />
            </Field>
            <Field label={t("dailyIndexBytes")}>
              <input
                value={draft.dailyIndexBytesLimit}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    dailyIndexBytesLimit: event.target.value,
                  }))
                }
                inputMode="numeric"
                className="field-input"
              />
            </Field>
            <Field label={t("subaccounts")}>
              <input
                value={draft.subaccountLimit}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    subaccountLimit: event.target.value,
                  }))
                }
                inputMode="numeric"
                className="field-input"
              />
            </Field>
            <Field label={t("sortOrder")}>
              <input
                value={draft.sortOrder}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    sortOrder: event.target.value,
                  }))
                }
                inputMode="numeric"
                className="field-input"
              />
            </Field>
            <Field label={t("status")}>
              <label className="flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={draft.active}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      active: event.target.checked,
                    }))
                  }
                />
                {t("listedOnPurchasePage")}
              </label>
            </Field>
            <div className="md:col-span-2">
              <Field label={t("description")}>
                <input
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder={t("descriptionPlaceholder")}
                  className="field-input"
                />
              </Field>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button variant="glass" size="sm" disabled={busy} onClick={save}>
              {busy ? t("saving") : t("savePlan")}
            </Button>
            {notice && (
              <p
                className={cn(
                  "text-xs",
                  noticeOk ? "text-emerald-400" : "text-red-400"
                )}
              >
                {notice}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-white">{t("configuredPlans")}</h3>
        <Button variant="ghost" size="sm" onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {plans?.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/[0.1] py-10 text-center text-sm text-slate-500">
          {t("noPlans")}
        </p>
      ) : (
        <div className="space-y-2">
          {plans?.map((plan) => (
            <div
              key={plan.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-white/[0.06] bg-[#0a0f1a]/60 px-4 py-3 text-xs"
            >
              <div className="min-w-36">
                <p className="text-sm font-medium text-slate-200">{plan.name}</p>
                <p className="font-mono text-slate-600">{plan.code}</p>
              </div>
              <Badge
                variant="outline"
                className={
                  plan.active
                    ? "border-emerald-500/20 text-emerald-400"
                    : "border-white/[0.08] text-slate-600"
                }
              >
                {plan.active ? t("active") : t("inactive")}
              </Badge>
              <span className="font-mono text-slate-300">
                ¥{(plan.priceFen / 100).toFixed(2)} / {t("days", { count: plan.durationDays })}
              </span>
              <span className="text-slate-500">
                {t("requests")} {plan.dailyRequestLimit === 0 ? t("unlimited") : plan.dailyRequestLimit.toLocaleString()}
              </span>
              <span className="text-slate-500">
                {t("index")} {formatBytes(plan.dailyIndexBytesLimit, t("unlimited"))}
              </span>
              <span className="text-slate-500">{t("subaccounts")} {plan.subaccountLimit}</span>
              <div className="ml-auto flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => edit(plan)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => remove(plan)}>
                  <Trash2 className="h-4 w-4 text-red-400" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <style jsx>{`
        :global(.field-input) {
          width: 100%;
          height: 2.25rem;
          border-radius: 0.5rem;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.03);
          padding: 0 0.75rem;
          color: rgb(226 232 240);
          font-size: 0.75rem;
          outline: none;
        }
        :global(.field-input:focus) {
          border-color: rgba(6, 182, 212, 0.4);
        }
      `}</style>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] text-slate-500">{label}</span>
      {children}
    </label>
  );
}
