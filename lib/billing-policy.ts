export type SubscriptionTier = "free" | "pro";

export interface SubscriptionEntitlements {
  planId: string;
  planName: string;
  tier: SubscriptionTier;
  dailyRequestLimit: number;
  dailyIndexBytesLimit: number;
  subaccountLimit: number;
}

export interface ActiveSubscriptionEntitlements extends SubscriptionEntitlements {
  startsAt: Date;
  expiresAt: Date;
}

export type SubscriptionPurchaseKind = "new" | "renewal" | "upgrade";

export interface SubscriptionTransition {
  kind: SubscriptionPurchaseKind;
  entitlements: SubscriptionEntitlements;
  startsAt: Date;
  expiresAt: Date;
}

const DAY_MS = 86_400_000;
const TIER_RANK: Record<SubscriptionTier, number> = { free: 0, pro: 1 };

function assertLimit(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`INVALID_${field.toUpperCase()}`);
  }
}

function quotaRank(value: number): number {
  // Request and index quotas persist 0 as unlimited.
  return value === 0 ? Number.POSITIVE_INFINITY : value;
}

function strongerQuota(current: number, target: number): number {
  if (current === 0 || target === 0) return 0;
  return Math.max(current, target);
}

function validateEntitlements(value: SubscriptionEntitlements): void {
  if (!value.planId || !value.planName) throw new Error("INVALID_PLAN_SNAPSHOT");
  if (value.tier !== "free" && value.tier !== "pro") {
    throw new Error("INVALID_PLAN_TIER");
  }
  assertLimit(value.dailyRequestLimit, "daily_request_limit");
  assertLimit(value.dailyIndexBytesLimit, "daily_index_bytes_limit");
  assertLimit(value.subaccountLimit, "subaccount_limit");
}

function targetDominatesCurrent(
  current: SubscriptionEntitlements,
  target: SubscriptionEntitlements
): boolean {
  return (
    TIER_RANK[target.tier] >= TIER_RANK[current.tier] &&
    quotaRank(target.dailyRequestLimit) >= quotaRank(current.dailyRequestLimit) &&
    quotaRank(target.dailyIndexBytesLimit) >= quotaRank(current.dailyIndexBytesLimit) &&
    target.subaccountLimit >= current.subaccountLimit
  );
}

function mergeRenewalEntitlements(
  current: SubscriptionEntitlements,
  target: SubscriptionEntitlements
): SubscriptionEntitlements {
  // A plan edited after purchase must never silently reduce an existing customer's
  // rights at renewal. Improvements are applied, reductions retain the old value.
  return {
    planId: target.planId,
    planName: target.planName,
    tier: TIER_RANK[target.tier] >= TIER_RANK[current.tier] ? target.tier : current.tier,
    dailyRequestLimit: strongerQuota(current.dailyRequestLimit, target.dailyRequestLimit),
    dailyIndexBytesLimit: strongerQuota(
      current.dailyIndexBytesLimit,
      target.dailyIndexBytesLimit
    ),
    // Unlike request/index quotas, zero seats means no subaccounts, not unlimited.
    subaccountLimit: Math.max(current.subaccountLimit, target.subaccountLimit),
  };
}

export function addSubscriptionDays(base: Date, durationDays: number): Date {
  const timestamp = base.getTime();
  if (!Number.isFinite(timestamp)) throw new Error("INVALID_SUBSCRIPTION_BASE_TIME");
  if (!Number.isSafeInteger(durationDays) || durationDays <= 0) {
    throw new Error("INVALID_SUBSCRIPTION_DURATION");
  }
  const result = timestamp + durationDays * DAY_MS;
  if (!Number.isSafeInteger(result)) throw new Error("INVALID_SUBSCRIPTION_EXPIRY");
  const expiry = new Date(result);
  if (!Number.isFinite(expiry.getTime())) {
    throw new Error("INVALID_SUBSCRIPTION_EXPIRY");
  }
  return expiry;
}

export function resolveSubscriptionTransition(
  current: ActiveSubscriptionEntitlements | null,
  target: SubscriptionEntitlements,
  durationDays: number,
  effectiveAt: Date
): SubscriptionTransition {
  validateEntitlements(target);
  const effectiveTimestamp = effectiveAt.getTime();
  if (!Number.isFinite(effectiveTimestamp)) throw new Error("INVALID_PAYMENT_TIME");

  const active =
    current &&
    Number.isFinite(current.startsAt.getTime()) &&
    Number.isFinite(current.expiresAt.getTime()) &&
    current.startsAt.getTime() <= effectiveTimestamp &&
    current.expiresAt.getTime() > effectiveTimestamp
      ? current
      : null;

  if (!active) {
    return {
      kind: "new",
      entitlements: target,
      startsAt: new Date(effectiveTimestamp),
      expiresAt: addSubscriptionDays(effectiveAt, durationDays),
    };
  }

  validateEntitlements(active);
  if (active.planId === target.planId) {
    return {
      kind: "renewal",
      entitlements: mergeRenewalEntitlements(active, target),
      startsAt: new Date(active.startsAt),
      expiresAt: addSubscriptionDays(active.expiresAt, durationDays),
    };
  }

  if (!targetDominatesCurrent(active, target)) {
    throw new Error("SUBSCRIPTION_DOWNGRADE_NOT_ALLOWED");
  }

  const purchasedTermExpiry = addSubscriptionDays(effectiveAt, durationDays);
  if (purchasedTermExpiry.getTime() < active.expiresAt.getTime()) {
    // Without a price-credit/proration ledger, silently upgrading until the longer
    // old expiry would over-grant the higher tier, while shortening the expiry would
    // destroy already-paid time. Reject this ambiguous transition instead. The user
    // can choose a target term that covers the remaining entitlement window.
    throw new Error("SUBSCRIPTION_UPGRADE_TERM_TOO_SHORT");
  }
  return {
    kind: "upgrade",
    entitlements: target,
    startsAt: new Date(effectiveTimestamp),
    expiresAt: purchasedTermExpiry,
  };
}
