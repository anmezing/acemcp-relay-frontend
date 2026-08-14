"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

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

function formatBytes(value: number): string {
  if (value === 0) return "不限";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let current = value;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current.toFixed(current >= 10 || Number.isInteger(current) ? 0 : 1)} ${units[index]}`;
}

function parseInteger(value: string, label: string): number {
  if (!/^\d+$/.test(value.trim())) throw new Error(`${label}必须是非负整数`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label}超出安全范围`);
  return parsed;
}

function yuanToFen(value: string): number {
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error("价格格式应为 0.00");
  const result =
    BigInt(match[1]) * BigInt(100) +
    BigInt((match[2] || "").padEnd(2, "0"));
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("价格超出安全范围");
  }
  return Number(result);
}

export function AdminPlansTab() {
  const [plans, setPlans] = useState<BillingPlan[] | null>(null);
  const [draft, setDraft] = useState<PlanDraft>(EMPTY_DRAFT);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/admin/plans", { signal });
    const payload = (await response.json().catch(() => ({}))) as {
      plans?: BillingPlan[];
      error?: string;
    };
    if (!response.ok || !payload.plans) {
      throw new Error(payload.error || "套餐列表加载失败");
    }
    if (!signal?.aborted) {
      setPlans(payload.plans);
      setError("");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve()
      .then(() => load(controller.signal))
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "套餐列表加载失败");
        }
      });
    return () => controller.abort();
  }, [load]);

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
        priceFen: yuanToFen(draft.priceYuan),
        durationDays: parseInteger(draft.durationDays, "有效天数"),
        dailyRequestLimit: parseInteger(draft.dailyRequestLimit, "每日请求量"),
        dailyIndexBytesLimit: parseInteger(
          draft.dailyIndexBytesLimit,
          "每日索引字节"
        ),
        subaccountLimit: parseInteger(draft.subaccountLimit, "子账号数"),
        sortOrder: parseInteger(draft.sortOrder, "排序"),
        active: draft.active,
      };
      if (!body.code || !body.name || body.durationDays <= 0) {
        throw new Error("请完整填写套餐标识、名称和有效天数");
      }
      const response = await fetch("/api/admin/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "保存失败");
      await load();
      setDraft(EMPTY_DRAFT);
      setNotice("套餐已保存，新订单将使用这份配置");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (plan: BillingPlan) => {
    if (!window.confirm(`确定删除套餐“${plan.name}”？已有订单的套餐只能停用。`)) {
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
      if (!response.ok) throw new Error(payload.error || "删除失败");
      await load();
      setNotice("套餐已删除");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "删除失败");
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
                {draft.id ? "编辑套餐" : "新增套餐"}
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                0 表示不限。历史订单保存购买快照，修改套餐不会倒改已购权益。
              </p>
            </div>
            {draft.id && (
              <Button variant="ghost" size="sm" onClick={() => setDraft(EMPTY_DRAFT)}>
                <Plus className="mr-1 h-4 w-4" />
                新增
              </Button>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Field label="套餐标识">
              <input
                value={draft.code}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, code: event.target.value }))
                }
                placeholder="pro-monthly"
                className="field-input"
              />
            </Field>
            <Field label="套餐名称">
              <input
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Pro 月付"
                className="field-input"
              />
            </Field>
            <Field label="等级">
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
            <Field label="价格（元）">
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
            <Field label="有效天数">
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
            <Field label="每日请求量">
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
            <Field label="每日索引字节">
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
            <Field label="子账号数">
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
            <Field label="排序">
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
            <Field label="状态">
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
                在购买页上架
              </label>
            </Field>
            <div className="md:col-span-2">
              <Field label="说明">
                <input
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder="适合个人开发者"
                  className="field-input"
                />
              </Field>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button variant="glass" size="sm" disabled={busy} onClick={save}>
              {busy ? "保存中..." : "保存套餐"}
            </Button>
            {notice && (
              <p
                className={cn(
                  "text-xs",
                  notice.includes("已") ? "text-emerald-400" : "text-red-400"
                )}
              >
                {notice}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-white">已配置套餐</h3>
        <Button variant="ghost" size="sm" onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {plans?.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/[0.1] py-10 text-center text-sm text-slate-500">
          暂无套餐。上方创建后，用户购买页才会显示。
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
                {plan.active ? "已上架" : "已停用"}
              </Badge>
              <span className="font-mono text-slate-300">
                ¥{(plan.priceFen / 100).toFixed(2)} / {plan.durationDays}天
              </span>
              <span className="text-slate-500">
                请求 {plan.dailyRequestLimit === 0 ? "不限" : plan.dailyRequestLimit.toLocaleString()}
              </span>
              <span className="text-slate-500">
                索引 {formatBytes(plan.dailyIndexBytesLimit)}
              </span>
              <span className="text-slate-500">子账号 {plan.subaccountLimit}</span>
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
