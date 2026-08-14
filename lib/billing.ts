import crypto from "crypto";
import pool, {
  deleteOrgQuotaCache,
  deleteQuotaLimitCache,
  initDB,
} from "@/lib/db";

export type BillingTier = "free" | "pro";
export type PaymentProvider = "alipay" | "wechat";
export type BillingOrderStatus = "pending" | "paid" | "closed" | "failed";

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
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`INVALID_${field.toUpperCase()}`);
  }
  return parsed;
}

function mapPlan(row: Record<string, unknown>): BillingPlan {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    description: String(row.description ?? ""),
    tier: row.tier === "pro" ? "pro" : "free",
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
    active: row.active === true,
    sortOrder: finiteNumber(row.sort_order, "sort_order"),
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

function parseSnapshot(value: unknown): PlanSnapshot {
  const row =
    typeof value === "string"
      ? (JSON.parse(value) as Record<string, unknown>)
      : (value as Record<string, unknown>);
  return {
    planId: String(row.planId),
    code: String(row.code),
    name: String(row.name),
    tier: row.tier === "pro" ? "pro" : "free",
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
    userId: String(row.user_id),
    planId: String(row.plan_id),
    planName: String(row.plan_name),
    tier: row.tier === "pro" ? "pro" : "free",
    dailyRequestLimit: finiteNumber(
      row.daily_request_limit,
      "daily_request_limit"
    ),
    dailyIndexBytesLimit: finiteNumber(
      row.daily_index_bytes_limit,
      "daily_index_bytes_limit"
    ),
    subaccountLimit: finiteNumber(row.subaccount_limit, "subaccount_limit"),
    startsAt: new Date(String(row.starts_at)),
    expiresAt: new Date(String(row.expires_at)),
    sourceOrderId: String(row.source_order_id),
    updatedAt: new Date(String(row.updated_at)),
  };
}

function mapOrder(row: Record<string, unknown>): BillingOrder {
  return {
    id: String(row.id),
    orderNo: String(row.order_no),
    userId: String(row.user_id),
    planId: String(row.plan_id),
    provider: row.provider === "wechat" ? "wechat" : "alipay",
    status:
      row.status === "paid" ||
      row.status === "closed" ||
      row.status === "failed"
        ? row.status
        : "pending",
    amountFen: finiteNumber(row.amount_fen, "amount_fen"),
    currency: String(row.currency),
    planSnapshot: parseSnapshot(row.plan_snapshot),
    providerTradeNo:
      typeof row.provider_trade_no === "string"
        ? row.provider_trade_no
        : null,
    codeUrl: typeof row.code_url === "string" ? row.code_url : null,
    expiresAt: new Date(String(row.expires_at)),
    paidAt: row.paid_at ? new Date(String(row.paid_at)) : null,
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
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
  const code = input.code.trim().toLowerCase();
  const name = input.name.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(code)) {
    throw new Error("INVALID_PLAN_CODE");
  }
  if (!name || name.length > 120) throw new Error("INVALID_PLAN_NAME");
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
  if (
    priceFen < 0 ||
    durationDays <= 0 ||
    dailyRequestLimit < 0 ||
    dailyIndexBytesLimit < 0 ||
    subaccountLimit < 0
  ) {
    throw new Error("INVALID_PLAN_LIMIT");
  }

  const id = input.id?.trim() || crypto.randomUUID();
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
      (input.description ?? "").trim(),
      input.tier,
      priceFen,
      durationDays,
      dailyRequestLimit,
      dailyIndexBytesLimit,
      subaccountLimit,
      input.active ?? true,
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
    `SELECT
       COALESCE((
         SELECT s.subaccount_limit
           FROM user_subscriptions s
          WHERE s.user_id = $1
            AND s.starts_at <= NOW()
            AND s.expires_at > NOW()
       ), 0)::int AS seat_limit,
       COUNT(DISTINCT counted."userId")::int AS used
     FROM "member" ownership
     JOIN "member" counted
       ON counted."organizationId" = ownership."organizationId"
      AND counted."userId" <> $1
    WHERE ownership."userId" = $1
      AND 'owner' = ANY(
        regexp_split_to_array(COALESCE(ownership.role, ''), '\\s*,\\s*')
      )`,
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
     usage AS (
       SELECT
         COUNT(DISTINCT counted."userId")::int AS used,
         COALESCE(
           BOOL_OR(counted."userId" = $2),
           FALSE
         ) AS candidate_already_counted
         FROM owner o
         JOIN "member" ownership
           ON ownership."userId" = o.user_id
          AND 'owner' = ANY(
            regexp_split_to_array(COALESCE(ownership.role, ''), '\\s*,\\s*')
          )
         JOIN "member" counted
           ON counted."organizationId" = ownership."organizationId"
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

    await client.query(
      `UPDATE billing_orders
          SET status = 'closed', updated_at = NOW()
        WHERE user_id = $1
          AND provider = $2
          AND status = 'pending'
          AND expires_at <= NOW()`,
      [userId, provider]
    );

    const existingResult = await client.query(
      `SELECT *
         FROM billing_orders
        WHERE user_id = $1
          AND provider = $2
          AND status = 'pending'
          AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE`,
      [userId, provider]
    );
    if (existingResult.rows[0]) {
      const existing = mapOrder(existingResult.rows[0]);
      if (existing.planId === plan.id && existing.codeUrl) {
        await client.query("COMMIT");
        return existing;
      }
      throw new Error("PAYMENT_ORDER_PENDING");
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60_000);
    const compactDate = now
      .toISOString()
      .slice(0, 10)
      .replaceAll("-", "");
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
  const client = await pool.connect();
  let paidOrder: BillingOrder | null = null;
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
    if (
      input.currency !== order.currency ||
      input.amountFen !== order.amountFen
    ) {
      throw new Error("ORDER_AMOUNT_MISMATCH");
    }
    if (order.status === "paid") {
      if (
        order.providerTradeNo &&
        order.providerTradeNo !== input.providerTradeNo
      ) {
        throw new Error("ORDER_TRADE_NO_MISMATCH");
      }
      paidOrder = order;
      await client.query("COMMIT");
    } else {
      await client.query(
        `SELECT pg_advisory_xact_lock(
           hashtext('acemcp:subaccounts'),
           hashtext($1)
         )`,
        [order.userId]
      );
      const currentResult = await client.query(
        `SELECT expires_at
           FROM user_subscriptions
          WHERE user_id = $1
          FOR UPDATE`,
        [order.userId]
      );
      const currentExpiry = currentResult.rows[0]?.expires_at
        ? new Date(currentResult.rows[0].expires_at)
        : null;
      const base =
        currentExpiry && currentExpiry.getTime() > input.paidAt.getTime()
          ? currentExpiry
          : input.paidAt;
      const nextExpiry = new Date(
        base.getTime() + order.planSnapshot.durationDays * 86_400_000
      );

      await client.query(
        `INSERT INTO user_subscriptions (
           user_id, plan_id, plan_name, tier, daily_request_limit,
           daily_index_bytes_limit, subaccount_limit, starts_at, expires_at,
         source_order_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (user_id) DO UPDATE SET
           plan_id = CASE
             WHEN EXCLUDED.starts_at >= user_subscriptions.starts_at
             THEN EXCLUDED.plan_id ELSE user_subscriptions.plan_id END,
           plan_name = CASE
             WHEN EXCLUDED.starts_at >= user_subscriptions.starts_at
             THEN EXCLUDED.plan_name ELSE user_subscriptions.plan_name END,
           tier = CASE
             WHEN EXCLUDED.starts_at >= user_subscriptions.starts_at
             THEN EXCLUDED.tier ELSE user_subscriptions.tier END,
           daily_request_limit = CASE
             WHEN EXCLUDED.starts_at >= user_subscriptions.starts_at
             THEN EXCLUDED.daily_request_limit
             ELSE user_subscriptions.daily_request_limit END,
           daily_index_bytes_limit = CASE
             WHEN EXCLUDED.starts_at >= user_subscriptions.starts_at
             THEN EXCLUDED.daily_index_bytes_limit
             ELSE user_subscriptions.daily_index_bytes_limit END,
           subaccount_limit = CASE
             WHEN EXCLUDED.starts_at >= user_subscriptions.starts_at
             THEN EXCLUDED.subaccount_limit
             ELSE user_subscriptions.subaccount_limit END,
           starts_at = GREATEST(user_subscriptions.starts_at, EXCLUDED.starts_at),
           expires_at = EXCLUDED.expires_at,
           source_order_id = CASE
             WHEN EXCLUDED.starts_at >= user_subscriptions.starts_at
             THEN EXCLUDED.source_order_id
             ELSE user_subscriptions.source_order_id END,
           updated_at = NOW()`,
        [
          order.userId,
          order.planSnapshot.planId,
          order.planSnapshot.name,
          order.planSnapshot.tier,
          order.planSnapshot.dailyRequestLimit,
          order.planSnapshot.dailyIndexBytesLimit,
          order.planSnapshot.subaccountLimit,
          input.paidAt,
          nextExpiry,
          order.id,
        ]
      );
      const updated = await client.query(
        `UPDATE billing_orders
            SET status = 'paid',
                provider_trade_no = $2,
                paid_at = $3,
                updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [order.id, input.providerTradeNo, input.paidAt]
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
  // 已支付回调也重新清缓存：若首次回调已提交数据库、但缓存服务临时失败，
  // 支付平台的幂等重试可以修复最终生效状态。
  await invalidateEntitlementCaches(paidOrder.userId);
  return paidOrder;
}

export async function getBillingOverview(userId: string) {
  const [plans, subscription, orders, seats] = await Promise.all([
    listBillingPlans(false),
    getActiveSubscription(userId),
    listUserOrders(userId),
    getSubaccountUsage(userId),
  ]);
  return { plans, subscription, orders, seats };
}

export async function closeExpiredOrders(): Promise<void> {
  await initDB();
  await pool.query(
    `UPDATE billing_orders
        SET status = 'closed', updated_at = NOW()
      WHERE status = 'pending' AND expires_at <= NOW()`
  );
}
