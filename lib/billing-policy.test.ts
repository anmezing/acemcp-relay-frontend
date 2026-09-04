import { expect, it } from "vitest";
import { addSubscriptionDays, resolveSubscriptionTransition } from "./billing-policy";

const now = new Date("2026-09-04T02:00:00.000Z");
const target = {
  planId: "pro-monthly",
  planName: "Pro monthly",
  tier: "pro" as const,
  dailyRequestLimit: 10_000,
  dailyIndexBytesLimit: 10_000_000,
  subaccountLimit: 5,
};

it("starts a new fixed-duration subscription at settlement time", () => {
  const result = resolveSubscriptionTransition(null, target, 30, now);
  expect(result.kind).toBe("new");
  expect(result.startsAt).toEqual(now);
  expect(result.expiresAt).toEqual(addSubscriptionDays(now, 30));
});

it("renews from the current expiry and preserves the original start", () => {
  const current = {
    ...target,
    startsAt: new Date("2026-08-15T02:00:00.000Z"),
    expiresAt: new Date("2026-09-15T02:00:00.000Z"),
  };
  const result = resolveSubscriptionTransition(current, target, 30, now);
  expect(result.kind).toBe("renewal");
  expect(result.startsAt).toEqual(current.startsAt);
  expect(result.expiresAt).toEqual(addSubscriptionDays(current.expiresAt, 30));
});

it("never reduces an existing entitlement when the same plan was edited", () => {
  const current = {
    ...target,
    dailyRequestLimit: 20_000,
    dailyIndexBytesLimit: 0,
    subaccountLimit: 10,
    startsAt: new Date("2026-08-15T02:00:00.000Z"),
    expiresAt: new Date("2026-09-15T02:00:00.000Z"),
  };
  const result = resolveSubscriptionTransition(current, target, 30, now);
  expect(result.entitlements.dailyRequestLimit).toBe(20_000);
  expect(result.entitlements.dailyIndexBytesLimit).toBe(0);
  expect(result.entitlements.subaccountLimit).toBe(10);
});

it("applies an upgrade immediately and grants a full target-plan term", () => {
  const current = {
    planId: "free-monthly",
    planName: "Free",
    tier: "free" as const,
    dailyRequestLimit: 1_000,
    dailyIndexBytesLimit: 1_000_000,
    subaccountLimit: 1,
    startsAt: new Date("2026-08-15T02:00:00.000Z"),
    expiresAt: new Date("2026-09-15T02:00:00.000Z"),
  };
  const result = resolveSubscriptionTransition(current, target, 30, now);
  expect(result.kind).toBe("upgrade");
  expect(result.startsAt).toEqual(now);
  expect(result.expiresAt).toEqual(addSubscriptionDays(now, 30));
});

it("rejects a non-prorated upgrade whose purchased term would shorten existing time", () => {
  const current = {
    planId: "free-annual",
    planName: "Free annual",
    tier: "free" as const,
    dailyRequestLimit: 1_000,
    dailyIndexBytesLimit: 1_000_000,
    subaccountLimit: 1,
    startsAt: new Date("2026-01-01T02:00:00.000Z"),
    expiresAt: new Date("2027-01-01T02:00:00.000Z"),
  };
  expect(() => resolveSubscriptionTransition(current, target, 30, now)).toThrowError(
    "SUBSCRIPTION_UPGRADE_TERM_TOO_SHORT"
  );
});

it("allows an upgrade whose purchased term ends exactly at the existing expiry", () => {
  const current = {
    planId: "free-monthly",
    planName: "Free monthly",
    tier: "free" as const,
    dailyRequestLimit: 1_000,
    dailyIndexBytesLimit: 1_000_000,
    subaccountLimit: 1,
    startsAt: new Date("2026-08-05T02:00:00.000Z"),
    expiresAt: addSubscriptionDays(now, 30),
  };
  const result = resolveSubscriptionTransition(current, target, 30, now);
  expect(result.kind).toBe("upgrade");
  expect(result.startsAt).toEqual(now);
  expect(result.expiresAt).toEqual(current.expiresAt);
});

it("treats a subscription as expired at the exact expiry instant", () => {
  const current = {
    ...target,
    startsAt: new Date("2026-08-01T02:00:00.000Z"),
    expiresAt: new Date(now),
  };
  const result = resolveSubscriptionTransition(current, target, 30, now);
  expect(result.kind).toBe("new");
  expect(result.startsAt).toEqual(now);
  expect(result.expiresAt).toEqual(addSubscriptionDays(now, 30));
});

it("rejects durations that overflow the JavaScript date range", () => {
  expect(() => addSubscriptionDays(now, 100_000_000)).toThrowError(
    "INVALID_SUBSCRIPTION_EXPIRY"
  );
});

it("rejects mixed or lower entitlements as a downgrade", () => {
  const current = {
    ...target,
    startsAt: new Date("2026-08-15T02:00:00.000Z"),
    expiresAt: new Date("2026-09-15T02:00:00.000Z"),
  };
  expect(() =>
    resolveSubscriptionTransition(
      current,
      { ...target, planId: "other", dailyRequestLimit: 9_999 },
      30,
      now
    )
  ).toThrowError("SUBSCRIPTION_DOWNGRADE_NOT_ALLOWED");
});



it("treats zero subaccount seats as none rather than unlimited", () => {
  const current = {
    ...target,
    subaccountLimit: 5,
    startsAt: new Date("2026-08-15T02:00:00.000Z"),
    expiresAt: new Date("2026-09-15T02:00:00.000Z"),
  };
  expect(() =>
    resolveSubscriptionTransition(
      current,
      { ...target, planId: "other", subaccountLimit: 0 },
      30,
      now
    )
  ).toThrowError("SUBSCRIPTION_DOWNGRADE_NOT_ALLOWED");
});

it("preserves existing subaccount seats when a same-plan renewal target has zero", () => {
  const current = {
    ...target,
    subaccountLimit: 5,
    startsAt: new Date("2026-08-15T02:00:00.000Z"),
    expiresAt: new Date("2026-09-15T02:00:00.000Z"),
  };
  const result = resolveSubscriptionTransition(
    current,
    { ...target, subaccountLimit: 0 },
    30,
    now
  );
  expect(result.kind).toBe("renewal");
  expect(result.entitlements.subaccountLimit).toBe(5);
});
