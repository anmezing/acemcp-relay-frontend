import crypto from "crypto";
import type { PoolClient } from "pg";
import {
  addSubscriptionDays,
  resolveSubscriptionTransition,
} from "@/lib/billing-policy";
import pool, {
  deleteOrgQuotaCache,
  deleteQuotaLimitCache,
  getDailyQuotaUsage,
  initDB,
} from "@/lib/db";

export type BillingTier = "free" | "pro";
export type PaymentProvider = "alipay" | "wechat";
export type BillingOrderStatus =
  | "pending"
  | "paid"
  | "closed"
  | "canceled"
  | "failed";
export type BillingFulfillmentStatus = "pending" | "applied" | "manual_review";

export interface BillingPlan {
  id: string;
  code: string;
  name: string;
  description: string;
  tier: BillingTier;
  priceFen: number;
  durationDays: number;
  dailyRequestLimit: number;
  dailyIndexBytesLimit: number;
  subaccountLimit: number;
  active: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlanSnapshot {
  planId: string;
  code: string;
  name: string;
  tier: BillingTier;
  durationDays: number;
  dailyRequestLimit: number;
  dailyIndexBytesLimit: number;
  subaccountLimit: number;
}

export interface UserSubscription {
  userId: string;
  planId: string;
  planName: string;
  tier: BillingTier;
  dailyRequestLimit: number;
  dailyIndexBytesLimit: number;
  subaccountLimit: number;
  startsAt: Date;
  expiresAt: Date;
  sourceOrderId: string;
  updatedAt: Date;
}

export interface BillingOrder {
  id: string;
  orderNo: string;
  userId: string;
  planId: string;
  provider: PaymentProvider;
  status: BillingOrderStatus;
  fulfillmentStatus: BillingFulfillmentStatus;
  fulfillmentError: string | null;
  fulfillmentEffectiveAt: Date | null;
  amountFen: number;
  currency: string;
  planSnapshot: PlanSnapshot;
  providerTradeNo: string | null;
  codeUrl: string | null;
  expiresAt: Date;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BillingPlanInput {
  id?: string;
  code: string;
  name: string;
  description?: string;
  tier: BillingTier;
  priceFen: number;
  durationDays: number;
  dailyRequestLimit: number;
  dailyIndexBytesLimit: number;
  subaccountLimit: number;
  active?: boolean;
  sortOrder?: number;
}

function finiteNumber(value: unknown, field: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^-?\d+$/.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`INVALID_${field.toUpperCase()}`);
  }
  return parsed;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`INVALID_${field.toUpperCase()}`);
  }
  return value;
}

function requiredDate(value: unknown, field: string): Date {
  const parsed =
    value instanceof Date
      ? new Date(value.getTime())
      : new Date(typeof value === "string" || typeof value === "number" ? value : Number.NaN);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`INVALID_${field.toUpperCase()}`);
  }
  return parsed;
}

function requiredTier(value: unknown): BillingTier {
  if (value !== "free" && value !== "pro") throw new Error("INVALID_TIER");
  return value;
}

function requiredProvider(value: unknown): PaymentProvider {
  if (value !== "alipay" && value !== "wechat") {
    throw new Error("INVALID_PAYMENT_PROVIDER");
  }
  return value;
}

function requiredOrderStatus(value: unknown): BillingOrderStatus {
  if (
    value !== "pending" &&
    value !== "paid" &&
    value !== "closed" &&
    value !== "canceled" &&
    value !== "failed"
  ) {
    throw new Error("INVALID_ORDER_STATUS");
  }
  return value;
}

function requiredFulfillmentStatus(value: unknown): BillingFulfillmentStatus {
  if (value !== "pending" && value !== "applied" && value !== "manual_review") {
    throw new Error("INVALID_FULFILLMENT_STATUS");
  }
  return value;
}

function mapPlan(row: Record<string, unknown>): BillingPlan {
  return {
    id: requiredString(row.id, "plan_id"),
    code: requiredString(row.code, "plan_code"),
    name: requiredString(row.name, "plan_name"),
    description:
      row.description == null
        ? ""
        : typeof row.description === "string"
          ? row.description
          : (() => {
              throw new Error("INVALID_DESCRIPTION");
            })(),
    tier: requiredTier(row.tier),
    priceFen: finiteNumber(row.price_fen, "price_fen"),
    durationDays: finiteNumber(row.duration_days, "duration_days"),
    dailyRequestLimit: finiteNumber(
      row.daily_request_limit,
      "daily_request_limit"
    ),
    dailyIndexBytesLimit: finiteNumber(
      row.daily_index_bytes_limit,
      "daily_index_bytes_limit"
    ),
    subaccountLimit: finiteNumber(row.subaccount_limit, "subaccount_limit"),
    active: (() => {
      if (typeof row.active !== "boolean") throw new Error("INVALID_PLAN_ACTIVE");
      return row.active;
    })(),
    sortOrder: finiteNumber(row.sort_order, "sort_order"),
    createdAt: requiredDate(row.created_at, "plan_created_at"),
    updatedAt: requiredDate(row.updated_at, "plan_updated_at"),
  };
}

function parseSnapshot(value: unknown): PlanSnapshot {
  let parsed: unknown = value;
  try {
    if (typeof value === "string") parsed = JSON.parse(value);
  } catch {
    throw new Error("INVALID_PLAN_SNAPSHOT");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("INVALID_PLAN_SNAPSHOT");
  }
  const row = parsed as Record<string, unknown>;
  return {
    planId: requiredString(row.planId, "plan_snapshot"),
    code: requiredString(row.code, "plan_snapshot"),
    name: requiredString(row.name, "plan_snapshot"),
    tier: requiredTier(row.tier),
    durationDays: finiteNumber(row.durationDays, "duration_days"),
    dailyRequestLimit: finiteNumber(
      row.dailyRequestLimit,
      "daily_request_limit"
    ),
    dailyIndexBytesLimit: finiteNumber(
      row.dailyIndexBytesLimit,
      "daily_index_bytes_limit"
    ),
    subaccountLimit: finiteNumber(row.subaccountLimit, "subaccount_limit"),
  };
}

function mapSubscription(row: Record<string, unknown>): UserSubscription {
  return {
    userId: requiredString(row.user_id, "subscription_user_id"),
    planId: requiredString(row.plan_id, "subscription_plan_id"),
    planName: requiredString(row.plan_name, "subscription_plan_name"),
    tier: requiredTier(row.tier),
    dailyRequestLimit: finiteNumber(
      row.daily_request_limit,
      "daily_request_limit"
    ),
    dailyIndexBytesLimit: finiteNumber(
      row.daily_index_bytes_limit,
      "daily_index_bytes_limit"
    ),
    subaccountLimit: finiteNumber(row.subaccount_limit, "subaccount_limit"),
    startsAt: requiredDate(row.starts_at, "subscription_starts_at"),
    expiresAt: requiredDate(row.expires_at, "subscription_expires_at"),
    sourceOrderId: requiredString(row.source_order_id, "subscription_source_order_id"),
    updatedAt: requiredDate(row.updated_at, "subscription_updated_at"),
  };
}

function mapOrder(row: Record<string, unknown>): BillingOrder {
  return {
    id: requiredString(row.id, "order_id"),
    orderNo: requiredString(row.order_no, "order_no"),
    userId: requiredString(row.user_id, "order_user_id"),
    planId: requiredString(row.plan_id, "order_plan_id"),
    provider: requiredProvider(row.provider),
    status: requiredOrderStatus(row.status),
    fulfillmentStatus: requiredFulfillmentStatus(row.fulfillment_status),
    fulfillmentError:
      typeof row.fulfillment_error === "string" ? row.fulfillment_error : null,
    fulfillmentEffectiveAt:
      row.fulfillment_effective_at == null
        ? null
        : requiredDate(row.fulfillment_effective_at, "fulfillment_effective_at"),
    amountFen: finiteNumber(row.amount_fen, "amount_fen"),
    currency: requiredString(row.currency, "currency"),
    planSnapshot: parseSnapshot(row.plan_snapshot),
    providerTradeNo:
      typeof row.provider_trade_no === "string"
        ? row.provider_trade_no
        : null,
    codeUrl: typeof row.code_url === "string" ? row.code_url : null,
    expiresAt: requiredDate(row.expires_at, "order_expires_at"),
    paidAt: row.paid_at == null ? null : requiredDate(row.paid_at, "order_paid_at"),
    createdAt: requiredDate(row.created_at, "order_created_at"),
    updatedAt: requiredDate(row.updated_at, "order_updated_at"),
  };
}

function snapshotPlan(plan: BillingPlan): PlanSnapshot {
  return {
    planId: plan.id,
    code: plan.code,
    name: plan.name,
    tier: plan.tier,
    durationDays: plan.durationDays,
    dailyRequestLimit: plan.dailyRequestLimit,
    dailyIndexBytesLimit: plan.dailyIndexBytesLimit,
    subaccountLimit: plan.subaccountLimit,
  };
}

export async function listBillingPlans(
  includeInactive = false
): Promise<BillingPlan[]> {
  await initDB();
  const result = await pool.query(
    `SELECT *
       FROM billing_plans
      ${includeInactive ? "" : "WHERE active = TRUE"}
      ORDER BY sort_order, price_fen, created_at`
  );
  return result.rows.map(mapPlan);
}

export async function saveBillingPlan(
  input: BillingPlanInput
): Promise<BillingPlan> {
  await initDB();
  if (!input || typeof input !== "object") {
    throw new Error("INVALID_PLAN_INPUT");
  }
  const code = typeof input.code === "string" ? input.code.trim().toLowerCase() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const description =
    input.description === undefined
      ? ""
      : typeof input.description === "string"
        ? input.description.trim()
        : (() => {
            throw new Error("INVALID_PLAN_DESCRIPTION");
          })();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(code)) {
    throw new Error("INVALID_PLAN_CODE");
  }
  if (!name || name.length > 120) throw new Error("INVALID_PLAN_NAME");
  if (description.length > 2_000) throw new Error("INVALID_PLAN_DESCRIPTION");
  if (input.tier !== "free" && input.tier !== "pro") {
    throw new Error("INVALID_PLAN_TIER");
  }

  const priceFen = finiteNumber(input.priceFen, "price_fen");
  const durationDays = finiteNumber(input.durationDays, "duration_days");
  const dailyRequestLimit = finiteNumber(
    input.dailyRequestLimit,
    "daily_request_limit"
  );
  const dailyIndexBytesLimit = finiteNumber(
    input.dailyIndexBytesLimit,
    "daily_index_bytes_limit"
  );
  const subaccountLimit = finiteNumber(
    input.subaccountLimit,
    "subaccount_limit"
  );
  const sortOrder = finiteNumber(input.sortOrder ?? 0, "sort_order");
  const active = input.active ?? true;
  if (typeof active !== "boolean") throw new Error("INVALID_PLAN_ACTIVE");
  if (
    priceFen < 0 ||
    durationDays <= 0 ||
    dailyRequestLimit < 0 ||
    dailyIndexBytesLimit < 0 ||
    subaccountLimit < 0 ||
    subaccountLimit > 2_147_483_647 ||
    sortOrder < -2_147_483_648 ||
    sortOrder > 2_147_483_647
  ) {
    throw new Error("INVALID_PLAN_LIMIT");
  }
  // Validate the fixed-duration term before persisting it. This catches values
  // that fit PostgreSQL INTEGER but cannot produce a valid JavaScript timestamp.
  addSubscriptionDays(new Date(), durationDays);

  if (input.id !== undefined && typeof input.id !== "string") {
    throw new Error("INVALID_PLAN_ID");
  }
  const suppliedId = input.id?.trim();
  if (suppliedId && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(suppliedId)) {
    throw new Error("INVALID_PLAN_ID");
  }
  const id = suppliedId || crypto.randomUUID();
  const result = await pool.query(
    `INSERT INTO billing_plans (
       id, code, name, description, tier, price_fen, duration_days,
       daily_request_limit, daily_index_bytes_limit, subaccount_limit,
       active, sort_order
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (id) DO UPDATE SET
       code = EXCLUDED.code,
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       tier = EXCLUDED.tier,
       price_fen = EXCLUDED.price_fen,
       duration_days = EXCLUDED.duration_days,
       daily_request_limit = EXCLUDED.daily_request_limit,
       daily_index_bytes_limit = EXCLUDED.daily_index_bytes_limit,
       subaccount_limit = EXCLUDED.subaccount_limit,
       active = EXCLUDED.active,
       sort_order = EXCLUDED.sort_order,
       updated_at = NOW()
     RETURNING *`,
    [
      id,
      code,
      name,
      description,
      input.tier,
      priceFen,
      durationDays,
      dailyRequestLimit,
      dailyIndexBytesLimit,
      subaccountLimit,
      active,
      sortOrder,
    ]
  );
  return mapPlan(result.rows[0]);
}

export async function deleteBillingPlan(id: string): Promise<boolean> {
  await initDB();
  const result = await pool.query(
    `DELETE FROM billing_plans p
      WHERE p.id = $1
        AND NOT EXISTS (
          SELECT 1 FROM billing_orders o WHERE o.plan_id = p.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM user_subscriptions s WHERE s.plan_id = p.id
        )`,
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getActiveSubscription(
  userId: string
): Promise<UserSubscription | null> {
  await initDB();
  const result = await pool.query(
    `SELECT *
       FROM user_subscriptions
      WHERE user_id = $1
        AND starts_at <= NOW()
        AND expires_at > NOW()`,
    [userId]
  );
  return result.rows[0] ? mapSubscription(result.rows[0]) : null;
}

export async function getSubaccountUsage(userId: string): Promise<{
  used: number;
  limit: number;
}> {
  await initDB();
  const result = await pool.query(
    `WITH canonical_ownership AS (
       SELECT organization_id, owner_user_id
         FROM (
           SELECT
             m."organizationId" AS organization_id,
             m."userId" AS owner_user_id,
             ROW_NUMBER() OVER (
               PARTITION BY m."organizationId"
               ORDER BY m."createdAt", m.id
             ) AS owner_rank
           FROM "member" m
           WHERE 'owner' = ANY(
             regexp_split_to_array(COALESCE(m.role, ''), '\\s*,\\s*')
           )
         ) ranked
        WHERE owner_rank = 1
     )
     SELECT
       COALESCE((
         SELECT s.subaccount_limit
           FROM user_subscriptions s
          WHERE s.user_id = $1
            AND s.starts_at <= NOW()
            AND s.expires_at > NOW()
       ), 0)::int AS seat_limit,
       COUNT(DISTINCT counted."userId")::int AS used
     FROM canonical_ownership ownership
     JOIN "member" counted
       ON counted."organizationId" = ownership.organization_id
      AND counted."userId" <> $1
    WHERE ownership.owner_user_id = $1`,
    [userId]
  );
  return {
    used: finiteNumber(result.rows[0]?.used ?? 0, "used_seats"),
    limit: finiteNumber(result.rows[0]?.seat_limit ?? 0, "seat_limit"),
  };
}

export async function getOrganizationMembershipLimit(
  organizationId: string,
  candidateUserId: string
): Promise<number> {
  await initDB();
  const result = await pool.query(
    `WITH owner AS (
       SELECT m."userId" AS user_id
         FROM "member" m
        WHERE m."organizationId" = $1
          AND 'owner' = ANY(
            regexp_split_to_array(COALESCE(m.role, ''), '\\s*,\\s*')
          )
        ORDER BY m."createdAt", m.id
        LIMIT 1
     ),
     canonical_ownership AS (
       SELECT organization_id, owner_user_id
         FROM (
           SELECT
             m."organizationId" AS organization_id,
             m."userId" AS owner_user_id,
             ROW_NUMBER() OVER (
               PARTITION BY m."organizationId"
               ORDER BY m."createdAt", m.id
             ) AS owner_rank
           FROM "member" m
           WHERE 'owner' = ANY(
             regexp_split_to_array(COALESCE(m.role, ''), '\\s*,\\s*')
           )
         ) ranked
        WHERE owner_rank = 1
     ),
     usage AS (
       SELECT
         COUNT(DISTINCT counted."userId")::int AS used,
         COALESCE(
           BOOL_OR(counted."userId" = $2),
           FALSE
         ) AS candidate_already_counted
         FROM owner o
         JOIN canonical_ownership ownership
           ON ownership.owner_user_id = o.user_id
         JOIN "member" counted
           ON counted."organizationId" = ownership.organization_id
          AND counted."userId" <> o.user_id
     )
     SELECT
       (SELECT COUNT(*)::int FROM "member" WHERE "organizationId" = $1)
         AS target_members,
       COALESCE((
         SELECT s.subaccount_limit
           FROM user_subscriptions s
           JOIN owner o ON o.user_id = s.user_id
          WHERE s.starts_at <= NOW()
            AND s.expires_at > NOW()
       ), 0)::int AS seat_limit,
       COALESCE((SELECT used FROM usage), 0)::int AS used,
       COALESCE(
         (SELECT candidate_already_counted FROM usage),
         FALSE
       ) AS candidate_already_counted,
       COALESCE((SELECT user_id = $2 FROM owner), FALSE) AS candidate_is_owner`,
    [organizationId, candidateUserId]
  );
  if (!result.rows[0]) return 1;
  const current = finiteNumber(
    result.rows[0].target_members ?? 0,
    "target_members"
  );
  const limit = finiteNumber(result.rows[0].seat_limit ?? 0, "seat_limit");
  const used = finiteNumber(result.rows[0].used ?? 0, "used_seats");
  const doesNotConsumeSeat =
    result.rows[0].candidate_already_counted === true ||
    result.rows[0].candidate_is_owner === true;
  return current + (doesNotConsumeSeat || used < limit ? 1 : 0);
}

export async function createPendingOrder(
  userId: string,
  planId: string,
  provider: PaymentProvider
): Promise<BillingOrder> {
  await initDB();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(
         hashtext('acemcp:billing-order'),
         hashtext($1)
       )`,
      [userId]
    );
    const planResult = await client.query(
      `SELECT * FROM billing_plans WHERE id = $1 AND active = TRUE FOR SHARE`,
      [planId]
    );
    if (!planResult.rows[0]) throw new Error("PLAN_NOT_FOUND");
    const plan = mapPlan(planResult.rows[0]);
    if (plan.priceFen <= 0) throw new Error("PLAN_NOT_PAYABLE");

    const clockResult = await client.query(`SELECT clock_timestamp() AS now`);
    const now = new Date(String(clockResult.rows[0]?.now));
    if (!Number.isFinite(now.getTime())) throw new Error("INVALID_DATABASE_TIME");
    const currentResult = await client.query(
      `SELECT *
         FROM user_subscriptions
        WHERE user_id = $1
          AND starts_at <= NOW()
          AND expires_at > NOW()
        FOR UPDATE`,
      [userId]
    );
    const current = currentResult.rows[0]
      ? mapSubscription(currentResult.rows[0])
      : null;
    // Reject a downgrade before creating an external payment order. Settlement
    // performs the same check again because the subscription can change later.
    resolveSubscriptionTransition(
      current,
      {
        planId: plan.id,
        planName: plan.name,
        tier: plan.tier,
        dailyRequestLimit: plan.dailyRequestLimit,
        dailyIndexBytesLimit: plan.dailyIndexBytesLimit,
        subaccountLimit: plan.subaccountLimit,
      },
      plan.durationDays,
      now
    );

    // A user may have only one live payment attempt, regardless of provider.
    // Otherwise Alipay and WeChat callbacks could settle competing plan changes.
    await client.query(
      `UPDATE billing_orders
          SET status = 'closed', updated_at = NOW()
        WHERE user_id = $1
          AND status = 'pending'
          AND expires_at <= NOW()`,
      [userId]
    );

    const existingResult = await client.query(
      `SELECT *
         FROM billing_orders
        WHERE user_id = $1
          AND status = 'pending'
          AND expires_at > NOW()
        ORDER BY created_at DESC, id DESC
        FOR UPDATE`,
      [userId]
    );
    if (existingResult.rows[0]) {
      const existing = mapOrder(existingResult.rows[0]);
      if (
        existing.planId === plan.id &&
        existing.provider === provider &&
        existing.codeUrl
      ) {
        await client.query("COMMIT");
        return existing;
      }
      throw new Error("PAYMENT_ORDER_PENDING");
    }

    const expiresAt = new Date(now.getTime() + 15 * 60_000);
    const compactDate = now.toISOString().slice(0, 10).replaceAll("-", "");
    const orderNo = `LCE${compactDate}${crypto
      .randomBytes(8)
      .toString("hex")
      .toUpperCase()}`;
    const result = await client.query(
      `INSERT INTO billing_orders (
         id, order_no, user_id, plan_id, provider, amount_fen, currency,
         plan_snapshot, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,'CNY',$7::jsonb,$8)
       RETURNING *`,
      [
        crypto.randomUUID(),
        orderNo,
        userId,
        plan.id,
        provider,
        plan.priceFen,
        JSON.stringify(snapshotPlan(plan)),
        expiresAt,
      ]
    );
    await client.query("COMMIT");
    return mapOrder(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function attachOrderCodeUrl(
  orderId: string,
  codeUrl: string
): Promise<BillingOrder> {
  const result = await pool.query(
    `UPDATE billing_orders
        SET code_url = $2, updated_at = NOW()
      WHERE id = $1 AND status = 'pending'
      RETURNING *`,
    [orderId, codeUrl]
  );
  if (!result.rows[0]) throw new Error("ORDER_NOT_PENDING");
  return mapOrder(result.rows[0]);
}

export async function failOrder(orderId: string): Promise<void> {
  await pool.query(
    `UPDATE billing_orders
        SET status = 'failed', updated_at = NOW()
      WHERE id = $1 AND status = 'pending'`,
    [orderId]
  );
}

export async function getUserOrder(
  userId: string,
  orderNo: string
): Promise<BillingOrder | null> {
  await initDB();
  const result = await pool.query(
    `SELECT * FROM billing_orders WHERE user_id = $1 AND order_no = $2`,
    [userId, orderNo]
  );
  return result.rows[0] ? mapOrder(result.rows[0]) : null;
}

export async function listUserOrders(
  userId: string,
  limit = 10
): Promise<BillingOrder[]> {
  await initDB();
  const result = await pool.query(
    `SELECT *
       FROM billing_orders
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, Math.min(Math.max(limit, 1), 50)]
  );
  return result.rows.map(mapOrder);
}

async function invalidateEntitlementCaches(userId: string): Promise<void> {
  try {
    await deleteQuotaLimitCache(userId);
    const result = await pool.query(
      `SELECT DISTINCT "organizationId"
         FROM "member"
        WHERE "userId" = $1
          AND 'owner' = ANY(
            regexp_split_to_array(COALESCE(role, ''), '\\s*,\\s*')
          )`,
      [userId]
    );
    await Promise.all(
      result.rows.map((row) => deleteOrgQuotaCache(String(row.organizationId)))
    );
  } catch (error) {
    // Entitlements are already durable when this runs. A cache/backend outage must
    // not turn a successful provider callback into a false settlement failure; the
    // next request can repopulate the cache and duplicate callbacks retry this step.
    console.error("billing entitlement cache invalidation failed:", { userId, error });
  }
}

type EntitlementApplication = {
  applied: boolean;
  error: string | null;
};

async function applyOrderEntitlement(
  client: PoolClient,
  order: BillingOrder,
  effectiveAt: Date
): Promise<EntitlementApplication> {
  await client.query(
    `SELECT pg_advisory_xact_lock(
       hashtext('acemcp:subaccounts'),
       hashtext($1)
     )`,
    [order.userId]
  );
  const currentResult = await client.query(
    `SELECT *
       FROM user_subscriptions
      WHERE user_id = $1
      FOR UPDATE`,
    [order.userId]
  );
  const current = currentResult.rows[0]
    ? mapSubscription(currentResult.rows[0])
    : null;

  try {
    const transition = resolveSubscriptionTransition(
      current,
      {
        planId: order.planSnapshot.planId,
        planName: order.planSnapshot.name,
        tier: order.planSnapshot.tier,
        dailyRequestLimit: order.planSnapshot.dailyRequestLimit,
        dailyIndexBytesLimit: order.planSnapshot.dailyIndexBytesLimit,
        subaccountLimit: order.planSnapshot.subaccountLimit,
      },
      order.planSnapshot.durationDays,
      effectiveAt
    );

    const usageResult = await client.query(
      `WITH canonical_ownership AS (
         SELECT organization_id, owner_user_id
           FROM (
             SELECT
               m."organizationId" AS organization_id,
               m."userId" AS owner_user_id,
               ROW_NUMBER() OVER (
                 PARTITION BY m."organizationId"
                 ORDER BY m."createdAt", m.id
               ) AS owner_rank
             FROM "member" m
             WHERE 'owner' = ANY(
               regexp_split_to_array(COALESCE(m.role, ''), '\\s*,\\s*')
             )
           ) ranked
          WHERE owner_rank = 1
       )
       SELECT COUNT(DISTINCT counted."userId")::int AS used
         FROM canonical_ownership ownership
         JOIN "member" counted
           ON counted."organizationId" = ownership.organization_id
          AND counted."userId" <> $1
        WHERE ownership.owner_user_id = $1`,
      [order.userId]
    );
    const usedSubaccounts = finiteNumber(
      usageResult.rows[0]?.used ?? 0,
      "used_seats"
    );
    if (usedSubaccounts > transition.entitlements.subaccountLimit) {
      throw new Error("SUBACCOUNT_LIMIT_BELOW_CURRENT_USAGE");
    }

    await client.query(
      `INSERT INTO user_subscriptions (
         user_id, plan_id, plan_name, tier, daily_request_limit,
         daily_index_bytes_limit, subaccount_limit, starts_at, expires_at,
         source_order_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (user_id) DO UPDATE SET
         plan_id = EXCLUDED.plan_id,
         plan_name = EXCLUDED.plan_name,
         tier = EXCLUDED.tier,
         daily_request_limit = EXCLUDED.daily_request_limit,
         daily_index_bytes_limit = EXCLUDED.daily_index_bytes_limit,
         subaccount_limit = EXCLUDED.subaccount_limit,
         starts_at = EXCLUDED.starts_at,
         expires_at = EXCLUDED.expires_at,
         source_order_id = EXCLUDED.source_order_id,
         updated_at = NOW()`,
      [
        order.userId,
        transition.entitlements.planId,
        transition.entitlements.planName,
        transition.entitlements.tier,
        transition.entitlements.dailyRequestLimit,
        transition.entitlements.dailyIndexBytesLimit,
        transition.entitlements.subaccountLimit,
        transition.startsAt,
        transition.expiresAt,
        order.id,
      ]
    );
    return { applied: true, error: null };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    if (
      error.message === "SUBSCRIPTION_DOWNGRADE_NOT_ALLOWED" ||
      error.message === "SUBSCRIPTION_UPGRADE_TERM_TOO_SHORT"
    ) {
      return { applied: false, error: "SUBSCRIPTION_CHANGED_AFTER_CHECKOUT" };
    }
    if (error.message === "SUBACCOUNT_LIMIT_BELOW_CURRENT_USAGE") {
      return { applied: false, error: error.message };
    }
    throw error;
  }
}

export async function markOrderPaid(input: {
  provider: PaymentProvider;
  orderNo: string;
  amountFen: number;
  currency: string;
  providerTradeNo: string;
  paidAt: Date;
}): Promise<BillingOrder> {
  await initDB();
  const providerTradeNo = input.providerTradeNo.trim();
  const paidTimestamp = input.paidAt.getTime();
  if (!providerTradeNo) throw new Error("INVALID_PROVIDER_TRADE_NO");
  if (!Number.isFinite(paidTimestamp)) throw new Error("INVALID_PAYMENT_TIME");

  const client = await pool.connect();
  let paidOrder: BillingOrder | null = null;
  let entitlementApplied = false;
  let fulfillmentError: string | null = null;
  try {
    await client.query("BEGIN");
    const orderResult = await client.query(
      `SELECT * FROM billing_orders
        WHERE order_no = $1 AND provider = $2
        FOR UPDATE`,
      [input.orderNo, input.provider]
    );
    if (!orderResult.rows[0]) throw new Error("ORDER_NOT_FOUND");
    const order = mapOrder(orderResult.rows[0]);
    if (input.currency !== order.currency || input.amountFen !== order.amountFen) {
      throw new Error("ORDER_AMOUNT_MISMATCH");
    }

    if (order.status === "paid") {
      if (order.providerTradeNo && order.providerTradeNo !== providerTradeNo) {
        throw new Error("ORDER_TRADE_NO_MISMATCH");
      }
      paidOrder = order;
      entitlementApplied = order.fulfillmentStatus === "applied";
      await client.query("COMMIT");
    } else {
      // failed means no valid provider order was created. A timed-out (closed) order
      // remains settleable because a signed callback can arrive late. An explicitly
      // canceled order is terminal because the provider has already confirmed closure.
      if (order.status === "failed" || order.status === "canceled") {
        throw new Error("ORDER_NOT_SETTLEABLE");
      }

      const clockResult = await client.query(
        `SELECT clock_timestamp() AS settled_at`
      );
      const settledAt = new Date(String(clockResult.rows[0]?.settled_at));
      if (!Number.isFinite(settledAt.getTime())) {
        throw new Error("INVALID_DATABASE_TIME");
      }
      const toleranceMs = 10 * 60_000;
      if (
        paidTimestamp > settledAt.getTime() + toleranceMs ||
        paidTimestamp < order.createdAt.getTime() - toleranceMs
      ) {
        throw new Error("INVALID_PAYMENT_TIME");
      }

      // The entitlement clock is the database settlement time, not the provider's
      // client-controlled timestamp. Persist it so a manual-review retry uses the
      // exact same entitlement boundary instead of granting a fresh term later.
      const application = await applyOrderEntitlement(client, order, settledAt);
      entitlementApplied = application.applied;
      fulfillmentError = application.error;

      const fulfillmentStatus = entitlementApplied ? "applied" : "manual_review";
      const updated = await client.query(
        `UPDATE billing_orders
            SET status = 'paid',
                fulfillment_status = $5,
                fulfillment_error = $6,
                fulfillment_effective_at = $4,
                provider_trade_no = $2,
                paid_at = $3,
                updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [
          order.id,
          providerTradeNo,
          input.paidAt,
          settledAt,
          fulfillmentStatus,
          fulfillmentError,
        ]
      );
      paidOrder = mapOrder(updated.rows[0]);
      await client.query("COMMIT");
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  if (!paidOrder) throw new Error("ORDER_SETTLEMENT_FAILED");
  if (entitlementApplied) await invalidateEntitlementCaches(paidOrder.userId);
  return paidOrder;
}

export async function listManualReviewOrders(
  limit = 100
): Promise<BillingOrder[]> {
  await initDB();
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error("INVALID_ORDER_LIMIT");
  }
  const result = await pool.query(
    `SELECT *
       FROM billing_orders
      WHERE status = 'paid'
        AND fulfillment_status = 'manual_review'
      ORDER BY updated_at DESC, id DESC
      LIMIT $1`,
    [Math.min(limit, 500)]
  );
  return result.rows.map(mapOrder);
}

export async function reconcilePaidOrder(
  orderNo: string
): Promise<BillingOrder> {
  await initDB();
  const normalizedOrderNo = orderNo.trim();
  if (!normalizedOrderNo) throw new Error("INVALID_ORDER_NO");

  const client = await pool.connect();
  let reconciled: BillingOrder | null = null;
  let entitlementApplied = false;
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT *
         FROM billing_orders
        WHERE order_no = $1
        FOR UPDATE`,
      [normalizedOrderNo]
    );
    if (!result.rows[0]) throw new Error("ORDER_NOT_FOUND");
    const order = mapOrder(result.rows[0]);
    if (order.status !== "paid") throw new Error("ORDER_NOT_PAID");
    if (order.fulfillmentStatus === "applied") {
      reconciled = order;
      entitlementApplied = true;
      await client.query("COMMIT");
    } else {
      if (order.fulfillmentStatus !== "manual_review") {
        throw new Error("ORDER_NOT_RECONCILABLE");
      }
      // New orders persist the database settlement timestamp. The paidAt fallback is
      // retained only for manual-review rows created before that column existed.
      const effectiveAt = order.fulfillmentEffectiveAt ?? order.paidAt;
      if (!effectiveAt) throw new Error("ORDER_EFFECTIVE_TIME_MISSING");
      const application = await applyOrderEntitlement(client, order, effectiveAt);
      entitlementApplied = application.applied;
      const updated = await client.query(
        `UPDATE billing_orders
            SET fulfillment_status = $2,
                fulfillment_error = $3,
                fulfillment_effective_at = COALESCE(fulfillment_effective_at, $4),
                updated_at = NOW()
          WHERE id = $1
            AND status = 'paid'
            AND fulfillment_status = 'manual_review'
          RETURNING *`,
        [
          order.id,
          application.applied ? "applied" : "manual_review",
          application.error,
          effectiveAt,
        ]
      );
      if (!updated.rows[0]) throw new Error("ORDER_STATE_CHANGED");
      reconciled = mapOrder(updated.rows[0]);
      await client.query("COMMIT");
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  if (!reconciled) throw new Error("ORDER_RECONCILIATION_FAILED");
  if (entitlementApplied) await invalidateEntitlementCaches(reconciled.userId);
  return reconciled;
}

export async function cancelPendingOrder(
  userId: string,
  orderNo: string
): Promise<BillingOrder> {
  await initDB();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT *
         FROM billing_orders
        WHERE user_id = $1 AND order_no = $2
        FOR UPDATE`,
      [userId, orderNo]
    );
    if (!result.rows[0]) throw new Error("ORDER_NOT_FOUND");
    const order = mapOrder(result.rows[0]);
    if (order.status === "canceled") {
      await client.query("COMMIT");
      return order;
    }
    if (order.status === "paid") throw new Error("ORDER_ALREADY_PAID");
    if (order.status === "closed") throw new Error("ORDER_ALREADY_EXPIRED");
    if (order.status !== "pending") throw new Error("ORDER_NOT_CANCELABLE");

    const updated = await client.query(
      `UPDATE billing_orders
          SET status = 'canceled', updated_at = NOW()
        WHERE id = $1 AND status = 'pending'
        RETURNING *`,
      [order.id]
    );
    if (!updated.rows[0]) throw new Error("ORDER_STATE_CHANGED");
    await client.query("COMMIT");
    return mapOrder(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function getBillingOverview(userId: string) {
  const [plans, subscription, orders, seats, usage, clockResult] = await Promise.all([
    listBillingPlans(false),
    getActiveSubscription(userId),
    listUserOrders(userId),
    getSubaccountUsage(userId),
    getDailyQuotaUsage(userId),
    pool.query(`SELECT clock_timestamp() AS effective_at`),
  ]);
  const effectiveAt = new Date(String(clockResult.rows[0]?.effective_at));
  if (!Number.isFinite(effectiveAt.getTime())) {
    throw new Error("INVALID_DATABASE_TIME");
  }
  const purchaseOptions = Object.fromEntries(
    plans.map((plan) => {
      try {
        const transition = resolveSubscriptionTransition(
          subscription,
          {
            planId: plan.id,
            planName: plan.name,
            tier: plan.tier,
            dailyRequestLimit: plan.dailyRequestLimit,
            dailyIndexBytesLimit: plan.dailyIndexBytesLimit,
            subaccountLimit: plan.subaccountLimit,
          },
          plan.durationDays,
          effectiveAt
        );
        return [plan.id, { allowed: true, kind: transition.kind }];
      } catch (error) {
        return [
          plan.id,
          {
            allowed: false,
            kind:
              error instanceof Error &&
              error.message === "SUBSCRIPTION_UPGRADE_TERM_TOO_SHORT"
                ? "upgrade_term_too_short"
                : "downgrade",
            reason: error instanceof Error ? error.message : "PLAN_CHANGE_NOT_ALLOWED",
          },
        ];
      }
    })
  );
  return { plans, subscription, orders, seats, usage, purchaseOptions };
}

export async function closeExpiredOrders(): Promise<void> {
  await initDB();
  await pool.query(
    `UPDATE billing_orders
        SET status = 'closed', updated_at = NOW()
      WHERE status = 'pending' AND expires_at <= NOW()`
  );
}
