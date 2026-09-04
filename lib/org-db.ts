import pool, {
  deleteOrgMemberQuotaCache,
  deleteOrgQuotaCache,
  generateApiKey,
  initDB,
  lockUserCredentialsTx,
} from "@/lib/db";

// 一人多密钥模型的组织侧数据访问：
// - 个人密钥：org_id/org_role 永远 NULL（lib/db.ts 管理），不因组织变动改变。
// - 组织密钥：每 (user, org) 唯一，org_role ∈ 'owner' | 'member'。
// relay 契约：tenant := key.org_id ?? user_id；delete-root 要求 org_role=owner。

// 用量统计里的“今天”统一按 Asia/Shanghai 自然日，与 relay 配额计数、
// admin-db 统计口径一致。
const TZ = "Asia/Shanghai";

export type OrgRole = "owner" | "member";

// better-auth 角色可能是逗号分隔多角色（如 "owner"、"admin,member"）。
// 契约里只有 owner/member 两档：含 owner 记 owner，其余一律 member。
export function toOrgRole(role: string | null | undefined): OrgRole {
  if (!role) return "member";
  return role.split(",").map((r) => r.trim()).includes("owner") ? "owner" : "member";
}

export interface ApiKeyRow {
  id: string;
  user_id: string;
  api_key: string;
  tier: string;
  org_id: string | null;
  org_role: string | null;
  created_at: Date;
  updated_at: Date;
}

// 组织密钥"存在即复用"：与 createApiKey 相同的锁 + FOR UPDATE 模式，
// 按 (user, org) 维度幂等。角色不一致时顺带纠正（幂等重放安全）。
export async function ensureOrgApiKey(
  userId: string,
  orgId: string,
  role: OrgRole
): Promise<ApiKeyRow> {
  await initDB();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockUserCredentialsTx(client, userId);
    const existing = await client.query(
      `SELECT * FROM api_keys WHERE user_id = $1 AND org_id = $2 FOR UPDATE`,
      [userId, orgId]
    );
    if (existing.rows[0]) {
      let row = existing.rows[0];
      if (row.org_role !== role) {
        const updated = await client.query(
          `UPDATE api_keys SET org_role = $3, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $1 AND org_id = $2 RETURNING *`,
          [userId, orgId, role]
        );
        row = updated.rows[0];
      }
      await client.query("COMMIT");
      return row;
    }
    const { id, apiKey } = generateApiKey();
    const result = await client.query(
      `INSERT INTO api_keys (id, user_id, api_key, tier, org_id, org_role)
       VALUES (
         $1, $2, $3,
         COALESCE((
           SELECT tier FROM api_keys
           WHERE user_id = $2::VARCHAR(255)
             AND org_id IS NULL
           ORDER BY created_at, id
           LIMIT 1
         ), 'free'),
         $4, $5
       )
       RETURNING *`,
      [id, userId, apiKey, orgId, role]
    );
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// 被移出/退出组织：删除该组织密钥和成员配额。Relay 以当前 member 表为
// 权威来源；已命中的进程内鉴权正缓存按约定最多保留 30 秒。
export async function deleteOrgApiKey(userId: string, orgId: string): Promise<void> {
  await initDB();
  const client = await pool.connect();
  try {
    await client.query(
      `DELETE FROM api_keys WHERE user_id = $1 AND org_id = $2`,
      [userId, orgId]
    );
    await client.query(
      `DELETE FROM org_member_quotas WHERE org_id = $1 AND user_id = $2`,
      [orgId, userId]
    );
  } finally {
    client.release();
  }
  await deleteOrgMemberQuotaCache(orgId, userId);
}

// 角色变更 / owner 转让：同步冗余展示字段；Relay 鉴权直接读取 member.role。
export async function updateOrgApiKeyRole(
  userId: string,
  orgId: string,
  role: OrgRole
): Promise<void> {
  await initDB();
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE api_keys SET org_role = $3, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND org_id = $2`,
      [userId, orgId, role]
    );
  } finally {
    client.release();
  }
}

// 组织删除：吊销该组织全部密钥 + 清共享配额。
export async function deleteAllOrgApiKeys(orgId: string): Promise<void> {
  await initDB();
  const client = await pool.connect();
  let quotaUserIds: string[] = [];
  try {
    await client.query(
      `DELETE FROM api_keys WHERE org_id = $1`,
      [orgId]
    );
    await client.query(`DELETE FROM org_quotas WHERE org_id = $1`, [orgId]);
    const quotas = await client.query(
      `DELETE FROM org_member_quotas WHERE org_id = $1 RETURNING user_id`,
      [orgId]
    );
    quotaUserIds = quotas.rows.map((r) => r.user_id);
  } finally {
    client.release();
  }
  for (const userId of quotaUserIds) {
    await deleteOrgMemberQuotaCache(orgId, userId);
  }
  await deleteOrgQuotaCache(orgId);
}

export interface UserKeyListRow {
  api_key: string;
  tier: string;
  org_id: string | null;
  org_role: string | null;
  org_name: string | null;
  created_at: Date;
}

// after hooks 是跨事务的快速同步，失败不能回滚 Better Auth 已提交的成员变更。
// 读取密钥列表时按权威成员表重放 ensure，补齐缺失密钥并修正冗余角色。
export async function reconcileUserOrgApiKeys(userId: string): Promise<void> {
  await initDB();
  const client = await pool.connect();
  let memberships: Array<{ org_id: string; role: string }> = [];
  try {
    const result = await client.query(
      `SELECT members."organizationId" AS org_id, members."role" AS role
       FROM "member" AS members
       INNER JOIN "organization" AS organizations
         ON organizations."id" = members."organizationId"
       WHERE members."userId" = $1
       ORDER BY members."organizationId"`,
      [userId]
    );
    memberships = result.rows;
  } finally {
    client.release();
  }
  for (const membership of memberships) {
    await ensureOrgApiKey(userId, membership.org_id, toOrgRole(membership.role));
  }
}

// 密钥管理页列表：个人密钥 + 各组织密钥（带组织名）。个人在前。
export async function listUserApiKeys(userId: string): Promise<UserKeyListRow[]> {
  await reconcileUserOrgApiKeys(userId);
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT k.api_key, k.tier, k.org_id, k.org_role, o."name" AS org_name, k.created_at
       FROM api_keys k
       LEFT JOIN "organization" o ON o."id" = k.org_id
       WHERE k.user_id = $1
       ORDER BY (k.org_id IS NOT NULL), o."name" NULLS FIRST, k.created_at`,
      [userId]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

// 会话用户在某组织中的角色（不是成员返回 null）。作为代理层鉴权依据，
// 读 better-auth 的 member 表（单一源头），而非 api_keys 冗余列。
export async function getMemberRole(
  userId: string,
  orgId: string
): Promise<OrgRole | null> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT "role" FROM "member" WHERE "userId" = $1 AND "organizationId" = $2`,
      [userId, orgId]
    );
    if (!result.rows[0]) return null;
    return toOrgRole(result.rows[0].role);
  } finally {
    client.release();
  }
}

export interface OrgMemberQuotaRow {
  user_id: string;
  daily_limit: number;
}

export async function listOrgMemberQuotas(orgId: string): Promise<OrgMemberQuotaRow[]> {
  await initDB();
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT user_id, daily_limit FROM org_member_quotas WHERE org_id = $1 ORDER BY user_id`,
      [orgId]
    );
    return result.rows.map((row) => ({
      user_id: row.user_id,
      daily_limit: Number(row.daily_limit),
    }));
  } finally {
    client.release();
  }
}

// limit: null = 恢复组织默认；0 = 不限；正整数 = 该成员在该组织内的每日上限。
export async function setOrgMemberQuota(
  orgId: string,
  userId: string,
  limit: number | null
): Promise<void> {
  await initDB();
  const client = await pool.connect();
  try {
    if (limit === null) {
      await client.query(
        `DELETE FROM org_member_quotas WHERE org_id = $1 AND user_id = $2`,
        [orgId, userId]
      );
    } else {
      await client.query(
        `INSERT INTO org_member_quotas (org_id, user_id, daily_limit)
         VALUES ($1, $2, $3)
         ON CONFLICT (org_id, user_id)
         DO UPDATE SET daily_limit = $3, updated_at = NOW()`,
        [orgId, userId, limit]
      );
    }
  } finally {
    client.release();
  }
  await deleteOrgMemberQuotaCache(orgId, userId);
}

// ── 组织用量（request_logs.tenant_id 由 relay 回填，只覆盖新数据）──────────

export type OrgQuotaSource =
  | "admin_override"
  | "subscription"
  | "owner_tier"
  | "platform_default";

interface OrgQuotaEntitlementRow {
  daily_request_limit?: string | number | null;
  daily_index_bytes_limit?: string | number | null;
  owner_user_id?: string | null;
  owner_daily_request_limit?: string | number | null;
  owner_daily_index_bytes_limit?: string | number | null;
  owner_tier?: string | null;
  plan_name?: string | null;
  subscription_daily_request_limit?: string | number | null;
  subscription_daily_index_bytes_limit?: string | number | null;
  subscription_expires_at?: Date | string | null;
}

interface EffectiveOrgQuota {
  dailyRequestLimit: number;
  dailyIndexBytesLimit: number;
  dailyRequestSource: OrgQuotaSource;
  dailyIndexBytesSource: OrgQuotaSource;
  planName: string | null;
  ownerTier: "free" | "pro";
}

// 与 relay.getOrgOwnerQuotaLimits 保持同一 canonical owner、有效订阅和基础
// tier 选择规则。查询固定返回一行，便于组织无 owner 时明确回退平台 Free 默认。
const ORG_EFFECTIVE_QUOTA_SQL = `
  /* org_effective_quota */
  SELECT q.daily_request_limit,
         q.daily_index_bytes_limit,
         canonical_owner.owner_user_id,
         owner_overrides.daily_limit AS owner_daily_request_limit,
         owner_overrides.daily_index_bytes_limit AS owner_daily_index_bytes_limit,
         COALESCE(owner_key.tier, 'free') AS owner_tier,
         subscriptions.plan_name,
         subscriptions.daily_request_limit AS subscription_daily_request_limit,
         subscriptions.daily_index_bytes_limit AS subscription_daily_index_bytes_limit,
         subscriptions.expires_at AS subscription_expires_at
  FROM (SELECT $1::text AS org_id) AS requested_org
  LEFT JOIN org_quotas AS q ON q.org_id = requested_org.org_id
  LEFT JOIN LATERAL (
    SELECT owners."userId" AS owner_user_id
    FROM "member" AS owners
    WHERE owners."organizationId" = requested_org.org_id
      AND (',' || regexp_replace(owners.role, '\\s', '', 'g') || ',') LIKE '%,owner,%'
    ORDER BY owners."createdAt", owners.id
    LIMIT 1
  ) AS canonical_owner ON TRUE
  LEFT JOIN user_quotas AS owner_overrides
    ON owner_overrides.user_id = canonical_owner.owner_user_id
  LEFT JOIN LATERAL (
    SELECT active.plan_name,
           active.daily_request_limit,
           active.daily_index_bytes_limit,
           active.expires_at
    FROM user_subscriptions AS active
    WHERE active.user_id = canonical_owner.owner_user_id
      AND active.starts_at <= NOW()
      AND active.expires_at > NOW()
    LIMIT 1
  ) AS subscriptions ON TRUE
  LEFT JOIN LATERAL (
    SELECT keys.tier
    FROM api_keys AS keys
    WHERE keys.user_id = canonical_owner.owner_user_id
      AND (keys.org_id IS NULL OR keys.org_id = requested_org.org_id)
    ORDER BY (keys.org_id IS NULL) DESC, keys.created_at, keys.id
    LIMIT 1
  ) AS owner_key ON TRUE
`;

function nullableQuotaLimit(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid quota limit: ${String(value)}`);
  }
  return parsed;
}

function configuredQuotaLimit(name: string): number {
  const raw = process.env[name] ?? "0";
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function resolveOrgQuota(row: OrgQuotaEntitlementRow | undefined): EffectiveOrgQuota {
  const requestOverride = nullableQuotaLimit(row?.daily_request_limit);
  const indexBytesOverride = nullableQuotaLimit(row?.daily_index_bytes_limit);
  const ownerRequestOverride = nullableQuotaLimit(row?.owner_daily_request_limit);
  const ownerIndexBytesOverride = nullableQuotaLimit(row?.owner_daily_index_bytes_limit);
  const subscriptionRequest = nullableQuotaLimit(row?.subscription_daily_request_limit);
  const subscriptionIndexBytes = nullableQuotaLimit(
    row?.subscription_daily_index_bytes_limit
  );
  const hasSubscription =
    subscriptionRequest !== null &&
    subscriptionIndexBytes !== null &&
    row?.subscription_expires_at != null;
  const ownerTier = row?.owner_tier?.trim() === "pro" ? "pro" : "free";
  const hasOwner = Boolean(row?.owner_user_id);
  const fallbackRequest = configuredQuotaLimit(
    ownerTier === "pro" ? "PRO_DAILY_REQUEST_LIMIT" : "DEFAULT_DAILY_REQUEST_LIMIT"
  );
  const fallbackIndexBytes = configuredQuotaLimit(
    ownerTier === "pro" ? "PRO_DAILY_INDEX_BYTES_LIMIT" : "DAILY_INDEX_BYTES_LIMIT"
  );
  const fallbackSource: OrgQuotaSource = hasOwner ? "owner_tier" : "platform_default";

  return {
    dailyRequestLimit:
      requestOverride ??
      ownerRequestOverride ??
      (hasSubscription ? subscriptionRequest : fallbackRequest),
    dailyIndexBytesLimit:
      indexBytesOverride ??
      ownerIndexBytesOverride ??
      (hasSubscription ? subscriptionIndexBytes : fallbackIndexBytes),
    dailyRequestSource:
      requestOverride !== null || ownerRequestOverride !== null
        ? "admin_override"
        : hasSubscription
          ? "subscription"
          : fallbackSource,
    dailyIndexBytesSource:
      indexBytesOverride !== null || ownerIndexBytesOverride !== null
        ? "admin_override"
        : hasSubscription
          ? "subscription"
          : fallbackSource,
    planName: hasSubscription ? row?.plan_name ?? null : null,
    ownerTier,
  };
}

export interface OrgUsage {
  daily: { date: string; count: number }[];
  topMembers: { user_id: string; email: string | null; name: string | null; count: number }[];
  // limit 是 relay 实际执行的最终额度；0 = 不限。
  today: { used: number; limit: number; source: OrgQuotaSource; planName: string | null };
}

// 组织近 30 天用量。所有 request_logs 查询都带 tenant_id 等值 + 时间窗，
// 命中 initDB 补的 (tenant_id, request_timestamp) 复合索引。
export async function getOrgUsage(orgId: string): Promise<OrgUsage> {
  const client = await pool.connect();
  try {
    const daily = await client.query(
      `SELECT to_char((request_timestamp AT TIME ZONE '${TZ}')::date, 'YYYY-MM-DD') AS date,
              COUNT(*) AS count
       FROM request_logs
       WHERE tenant_id = $1 AND request_timestamp > NOW() - INTERVAL '30 days'
       GROUP BY 1 ORDER BY 1`,
      [orgId]
    );
    const topMembers = await client.query(
      `SELECT rl.user_id, u.email, u.name, COUNT(*) AS count
       FROM request_logs rl
       LEFT JOIN "user" u ON u.id = rl.user_id
       WHERE rl.tenant_id = $1 AND rl.request_timestamp > NOW() - INTERVAL '30 days'
       GROUP BY rl.user_id, u.email, u.name
       ORDER BY 4 DESC LIMIT 10`,
      [orgId]
    );
    // 时区换算条件不可走索引范围扫描，先用 2 天窗口收敛再精确过滤
    const today = await client.query(
      `SELECT COUNT(*) AS used
       FROM request_logs
       WHERE tenant_id = $1
         AND request_timestamp > NOW() - INTERVAL '2 days'
         AND (request_timestamp AT TIME ZONE '${TZ}')::date = (NOW() AT TIME ZONE '${TZ}')::date`,
      [orgId]
    );
    const quota = await client.query(ORG_EFFECTIVE_QUOTA_SQL, [orgId]);
    const effectiveQuota = resolveOrgQuota(quota.rows[0]);
    return {
      daily: daily.rows.map((r) => ({ date: r.date, count: parseInt(r.count) })),
      topMembers: topMembers.rows.map((r) => ({
        user_id: r.user_id,
        email: r.email,
        name: r.name,
        count: parseInt(r.count),
      })),
      today: {
        used: parseInt(today.rows[0].used),
        limit: effectiveQuota.dailyRequestLimit,
        source: effectiveQuota.dailyRequestSource,
        planName: effectiveQuota.planName,
      },
    };
  } finally {
    client.release();
  }
}

// ── admin：组织列表与共享配额 ──────────────────────────────────────────

export interface AdminOrgRow {
  org_id: string;
  name: string;
  slug: string;
  owner_email: string | null;
  member_count: number;
  requests_7d: number;
  daily_request_limit: number | null;
  daily_index_bytes_limit: number | null;
  effective_daily_request_limit: number;
  effective_daily_index_bytes_limit: number;
  daily_request_source: OrgQuotaSource;
  daily_index_bytes_source: OrgQuotaSource;
  plan_name: string | null;
  owner_tier: "free" | "pro";
  created_at: Date;
}

export async function listOrgsWithQuotas(): Promise<AdminOrgRow[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      WITH member_stats AS (
        SELECT members."organizationId" AS org_id,
               COUNT(*)::int AS member_count
        FROM "member" AS members
        GROUP BY members."organizationId"
      ), request_stats AS (
        SELECT logs.tenant_id AS org_id,
               COUNT(*)::int AS requests_7d
        FROM request_logs AS logs
        WHERE logs.tenant_id IS NOT NULL
          AND logs.request_timestamp > NOW() - INTERVAL '7 days'
        GROUP BY logs.tenant_id
      )
      SELECT o."id" AS org_id, o."name", o."slug", o."createdAt" AS created_at,
        owner_user.email AS owner_email,
        COALESCE(member_stats.member_count, 0) AS member_count,
        COALESCE(request_stats.requests_7d, 0) AS requests_7d,
        q.daily_request_limit, q.daily_index_bytes_limit,
        canonical_owner.owner_user_id,
        owner_overrides.daily_limit AS owner_daily_request_limit,
        owner_overrides.daily_index_bytes_limit AS owner_daily_index_bytes_limit,
        COALESCE(owner_key.tier, 'free') AS owner_tier,
        subscriptions.plan_name,
        subscriptions.daily_request_limit AS subscription_daily_request_limit,
        subscriptions.daily_index_bytes_limit AS subscription_daily_index_bytes_limit,
        subscriptions.expires_at AS subscription_expires_at
      FROM "organization" o
      LEFT JOIN member_stats ON member_stats.org_id = o."id"
      LEFT JOIN request_stats ON request_stats.org_id = o."id"
      LEFT JOIN org_quotas q ON q.org_id = o."id"
      LEFT JOIN LATERAL (
        SELECT owners."userId" AS owner_user_id
        FROM "member" AS owners
        WHERE owners."organizationId" = o."id"
          AND (',' || regexp_replace(owners.role, '\\s', '', 'g') || ',') LIKE '%,owner,%'
        ORDER BY owners."createdAt", owners.id
        LIMIT 1
      ) AS canonical_owner ON TRUE
      LEFT JOIN "user" AS owner_user ON owner_user.id = canonical_owner.owner_user_id
      LEFT JOIN user_quotas AS owner_overrides
        ON owner_overrides.user_id = canonical_owner.owner_user_id
      LEFT JOIN LATERAL (
        SELECT active.plan_name,
               active.daily_request_limit,
               active.daily_index_bytes_limit,
               active.expires_at
        FROM user_subscriptions AS active
        WHERE active.user_id = canonical_owner.owner_user_id
          AND active.starts_at <= NOW()
          AND active.expires_at > NOW()
        LIMIT 1
      ) AS subscriptions ON TRUE
      LEFT JOIN LATERAL (
        SELECT keys.tier
        FROM api_keys AS keys
        WHERE keys.user_id = canonical_owner.owner_user_id
          AND (keys.org_id IS NULL OR keys.org_id = o."id")
        ORDER BY (keys.org_id IS NULL) DESC, keys.created_at, keys.id
        LIMIT 1
      ) AS owner_key ON TRUE
      ORDER BY o."createdAt" DESC
    `);
    return result.rows.map((r) => {
      const effectiveQuota = resolveOrgQuota(r);
      return {
        ...r,
        daily_request_limit: nullableQuotaLimit(r.daily_request_limit),
        daily_index_bytes_limit: nullableQuotaLimit(r.daily_index_bytes_limit),
        effective_daily_request_limit: effectiveQuota.dailyRequestLimit,
        effective_daily_index_bytes_limit: effectiveQuota.dailyIndexBytesLimit,
        daily_request_source: effectiveQuota.dailyRequestSource,
        daily_index_bytes_source: effectiveQuota.dailyIndexBytesSource,
        plan_name: effectiveQuota.planName,
        owner_tier: effectiveQuota.ownerTier,
      };
    });
  } finally {
    client.release();
  }
}

// 平台管理员写组织共享配额。null 列 = 未设置（relay 按默认值处理）。
export async function setOrgQuota(
  orgId: string,
  dailyRequestLimit: number | null,
  dailyIndexBytesLimit: number | null
): Promise<boolean> {
  await initDB();
  const client = await pool.connect();
  let saved = false;
  try {
    // fail-closed：组织不存在拒绝写入，避免孤儿配额行
    const org = await client.query(`SELECT 1 FROM "organization" WHERE "id" = $1`, [orgId]);
    if (!org.rows[0]) return false;
    await client.query(
      `INSERT INTO org_quotas (org_id, daily_request_limit, daily_index_bytes_limit)
       VALUES ($1, $2, $3)
       ON CONFLICT (org_id) DO UPDATE SET
         daily_request_limit = $2,
         daily_index_bytes_limit = $3,
         updated_at = NOW()`,
      [orgId, dailyRequestLimit, dailyIndexBytesLimit]
    );
    saved = true;
  } finally {
    client.release();
  }
  if (saved) await deleteOrgQuotaCache(orgId);
  return saved;
}
