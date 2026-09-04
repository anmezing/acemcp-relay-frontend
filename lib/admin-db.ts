import pool, {
  deleteBannedCache,
  deleteOrgQuotaCache,
  deleteQuotaLimitCache,
  resetApiKey,
} from "@/lib/db";

// 统计/配额里的“今天”统一按 Asia/Shanghai 自然日，与 relay 配额计数、
// leaderboard 口径一致。
const TZ = "Asia/Shanghai";

// 管理端聚合查询。调用方（/api/admin/*）必须先通过 requireAdminSession。

export interface AdminOverview {
  users: number;
  banned: number;
  totalRequests: number;
  requests24h: number;
  activeUsers24h: number;
  errors24h: number;
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM "user") AS users,
        (SELECT COUNT(*) FROM banned_users) AS banned,
        (SELECT COALESCE(SUM(total_count), 0) FROM request_log_user_stats) AS total_requests,
        (SELECT COUNT(*) FROM request_logs
          WHERE request_timestamp > NOW() - INTERVAL '24 hours') AS requests_24h,
        (SELECT COUNT(DISTINCT user_id) FROM request_logs
          WHERE request_timestamp > NOW() - INTERVAL '24 hours') AS active_users_24h,
        (SELECT COUNT(*) FROM request_logs
          WHERE request_timestamp > NOW() - INTERVAL '24 hours'
            AND (status_code >= 400 OR status = 'error')) AS errors_24h
    `);
    const r = result.rows[0];
    return {
      users: parseInt(r.users),
      banned: parseInt(r.banned),
      totalRequests: parseInt(r.total_requests),
      requests24h: parseInt(r.requests_24h),
      activeUsers24h: parseInt(r.active_users_24h),
      errors24h: parseInt(r.errors_24h),
    };
  } finally {
    client.release();
  }
}

export interface AdminUserRow {
  id: string;
  email: string | null;
  name: string | null;
  created_at: Date;
  request_count: number;
  last_request_at: Date | null;
  banned: boolean;
  tier: "free" | "pro";
  base_tier: "free" | "pro";
  subscription_plan_name: string | null;
  subscription_expires_at: Date | null;
  auth_providers: string[];
}

export async function listUsersWithStats(): Promise<AdminUserRow[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT u.id, u.email, u.name, u."createdAt" AS created_at,
        COALESCE(r.total_count, 0)::bigint AS request_count,
        latest.last_at AS last_request_at,
        (b.user_id IS NOT NULL) AS banned,
        COALESCE(s.tier, k.tier, 'free') AS tier,
        COALESCE(k.tier, 'free') AS base_tier,
        s.plan_name AS subscription_plan_name,
        s.expires_at AS subscription_expires_at,
        a.auth_providers
      FROM "user" u
      LEFT JOIN request_log_user_stats r ON r.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT request_timestamp AS last_at
          FROM request_logs latest_log
         WHERE latest_log.user_id = u.id
         ORDER BY request_timestamp DESC, id DESC
         LIMIT 1
      ) latest ON TRUE
      LEFT JOIN banned_users b ON b.user_id = u.id
      LEFT JOIN api_keys k ON k.user_id = u.id AND k.org_id IS NULL
      LEFT JOIN LATERAL (
        SELECT tier, plan_name, expires_at
          FROM user_subscriptions
         WHERE user_id = u.id
           AND starts_at <= NOW()
           AND expires_at > NOW()
         LIMIT 1
      ) s ON TRUE
      LEFT JOIN (
        SELECT "userId" AS user_id,
          ARRAY_AGG(DISTINCT "providerId" ORDER BY "providerId") AS auth_providers
        FROM account
        GROUP BY "userId"
      ) a ON a.user_id = u.id
      ORDER BY latest.last_at DESC NULLS LAST, u."createdAt" DESC
    `);
    return result.rows.map((r) => ({
      ...r,
      auth_providers: Array.isArray(r.auth_providers) ? r.auth_providers : [],
      request_count: parseInt(r.request_count),
    }));
  } finally {
    client.release();
  }
}

// 重置用户密钥：旧 token 立即失效（resetApiKey 内部会清 apikey 缓存）
export async function adminResetUserKey(userId: string) {
  return resetApiKey(userId);
}

// 设置用户 tier（'free' | 'pro'）。tier 存在 api_keys 上，一人多密钥后对该
// 用户全部密钥（个人 + 组织）统一生效；用户尚未生成任何 key 时无行可改（此时 relay 侧也无从认证），返回 false 让调用方报错。
// relay 认证缓存每 30 秒刷新，无需清缓存，半分钟内生效。
export async function adminSetTier(
  userId: string,
  tier: "free" | "pro"
): Promise<boolean> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `UPDATE api_keys SET tier = $2, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1`,
      [userId, tier]
    );
    return (result.rowCount || 0) > 0;
  } finally {
    client.release();
  }
}

export async function setUserBanned(userId: string, banned: boolean, reason?: string) {
  const client = await pool.connect();
  try {
    if (banned) {
      await client.query(
        `INSERT INTO banned_users (user_id, reason) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET reason = $2`,
        [userId, reason || null]
      );
    } else {
      await client.query(`DELETE FROM banned_users WHERE user_id = $1`, [userId]);
    }
  } finally {
    client.release();
  }
  await deleteBannedCache(userId);
}

export interface AdminLogRow {
  id: string;
  user_id: string;
  email: string | null;
  status: string;
  status_code: number | null;
  request_path: string;
  request_method: string;
  request_timestamp: Date;
  response_duration_ms: number | null;
  client_ip: string;
}

export async function listGlobalLogs(
  limit = 50,
  offset = 0,
  errorsOnly = false
): Promise<AdminLogRow[]> {
  const client = await pool.connect();
  try {
    const where = errorsOnly
      ? `WHERE rl.status_code >= 400 OR rl.status = 'error'`
      : "";
    const result = await client.query(
      `SELECT rl.id, rl.user_id, u.email, rl.status, rl.status_code,
              rl.request_path, rl.request_method, rl.request_timestamp,
              rl.response_duration_ms, rl.client_ip
       FROM request_logs rl
       LEFT JOIN "user" u ON u.id = rl.user_id
       ${where}
       ORDER BY rl.request_timestamp DESC, rl.id DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

// ── 调用统计（call-stats tab 的真实数据源：请求量，无 token 计量）────────

export interface CallStats {
  totals: { today: number; last30d: number; total: number };
  daily: { date: string; count: number }[];
  byPath: { path: string; count: number }[];
  topUsers: { user_id: string; email: string | null; count: number }[];
}

export async function getCallStats(): Promise<CallStats> {
  const client = await pool.connect();
  try {
    const totals = await client.query(`
      SELECT
        COALESCE((
          SELECT SUM(total_count)
            FROM request_log_daily_stats
           WHERE stat_date = (NOW() AT TIME ZONE '${TZ}')::date
        ), 0) AS today,
        COALESCE((
          SELECT SUM(total_count)
            FROM request_log_daily_stats
           WHERE stat_date >= (NOW() AT TIME ZONE '${TZ}')::date - 29
        ), 0) AS last30d,
        COALESCE((SELECT SUM(total_count) FROM request_log_user_stats), 0) AS total
    `);
    const daily = await client.query(`
      SELECT to_char(stat_date, 'YYYY-MM-DD') AS date,
             SUM(total_count) AS count
        FROM request_log_daily_stats
       WHERE stat_date >= (NOW() AT TIME ZONE '${TZ}')::date - 13
       GROUP BY stat_date
       ORDER BY stat_date DESC
    `);
    const byPath = await client.query(`
      SELECT request_path AS path, SUM(total_count) AS count
        FROM request_log_daily_stats
       WHERE stat_date >= (NOW() AT TIME ZONE '${TZ}')::date - 29
       GROUP BY request_path
       ORDER BY count DESC, request_path ASC
       LIMIT 10
    `);
    const topUsers = await client.query(`
      SELECT stats.user_id, u.email, SUM(stats.total_count) AS count
        FROM request_log_daily_stats stats
        LEFT JOIN "user" u ON u.id = stats.user_id
       WHERE stats.stat_date >= (NOW() AT TIME ZONE '${TZ}')::date - 29
       GROUP BY stats.user_id, u.email
       ORDER BY count DESC, stats.user_id ASC
       LIMIT 10
    `);
    const t = totals.rows[0];
    return {
      totals: {
        today: parseInt(t.today),
        last30d: parseInt(t.last30d),
        total: parseInt(t.total),
      },
      daily: daily.rows.map((r) => ({ date: r.date, count: parseInt(r.count) })),
      byPath: byPath.rows.map((r) => ({ path: r.path, count: parseInt(r.count) })),
      topUsers: topUsers.rows.map((r) => ({
        user_id: r.user_id,
        email: r.email,
        count: parseInt(r.count),
      })),
    };
  } finally {
    client.release();
  }
}

// ── 配额管理 ─────────────────────────────────────────────────────────────

export interface QuotaRow {
  user_id: string;
  email: string | null;
  today_count: number;
  daily_limit: number | null; // null = 使用默认值
  daily_index_bytes_limit: number | null;
  effective_daily_limit: number;
  effective_daily_index_bytes_limit: number;
  daily_limit_source: UserQuotaSource;
  daily_index_bytes_limit_source: UserQuotaSource;
  base_tier: "free" | "pro";
  subscription_plan_name: string | null;
}

export type UserQuotaSource =
  | "admin_override"
  | "subscription"
  | "base_tier"
  | "platform_default";

function nullableQuotaLimit(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`INVALID_QUOTA_LIMIT:${String(value)}`);
  }
  return parsed;
}

function configuredQuotaLimit(name: string): number {
  const parsed = Number(process.env[name] ?? "0");
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export async function listQuotas(): Promise<QuotaRow[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT u.id AS user_id, u.email, q.daily_limit,
        q.daily_index_bytes_limit, k.tier AS base_tier,
        s.plan_name AS subscription_plan_name,
        s.daily_request_limit AS subscription_daily_request_limit,
        s.daily_index_bytes_limit AS subscription_daily_index_bytes_limit,
        COALESCE(t.cnt, 0)::int AS today_count
      FROM "user" u
      LEFT JOIN user_quotas q ON q.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT keys.tier
          FROM api_keys keys
         WHERE keys.user_id = u.id
           AND keys.org_id IS NULL
         ORDER BY keys.created_at, keys.id
         LIMIT 1
      ) k ON TRUE
      LEFT JOIN LATERAL (
        SELECT active.plan_name,
               active.daily_request_limit,
               active.daily_index_bytes_limit
          FROM user_subscriptions active
         WHERE active.user_id = u.id
           AND active.starts_at <= NOW()
           AND active.expires_at > NOW()
         LIMIT 1
      ) s ON TRUE
      LEFT JOIN (
        SELECT user_id, SUM(total_count) AS cnt
          FROM request_log_daily_stats
         WHERE stat_date = (NOW() AT TIME ZONE '${TZ}')::date
         GROUP BY user_id
      ) t ON t.user_id = u.id
      ORDER BY t.cnt DESC NULLS LAST, u."createdAt" DESC
    `);
    return result.rows.map((row) => {
      const requestOverride = nullableQuotaLimit(row.daily_limit);
      const indexBytesOverride = nullableQuotaLimit(
        row.daily_index_bytes_limit
      );
      const subscriptionRequest = nullableQuotaLimit(
        row.subscription_daily_request_limit
      );
      const subscriptionIndexBytes = nullableQuotaLimit(
        row.subscription_daily_index_bytes_limit
      );
      const hasSubscription =
        row.subscription_plan_name != null &&
        subscriptionRequest !== null &&
        subscriptionIndexBytes !== null;
      const hasBaseTier = typeof row.base_tier === "string";
      const baseTier = row.base_tier?.trim() === "pro" ? "pro" : "free";
      const fallbackRequest = configuredQuotaLimit(
        baseTier === "pro"
          ? "PRO_DAILY_REQUEST_LIMIT"
          : "DEFAULT_DAILY_REQUEST_LIMIT"
      );
      const fallbackIndexBytes = configuredQuotaLimit(
        baseTier === "pro"
          ? "PRO_DAILY_INDEX_BYTES_LIMIT"
          : "DAILY_INDEX_BYTES_LIMIT"
      );
      const fallbackSource: UserQuotaSource = hasBaseTier
        ? "base_tier"
        : "platform_default";
      return {
        user_id: String(row.user_id),
        email: typeof row.email === "string" ? row.email : null,
        today_count: Number(row.today_count),
        daily_limit: requestOverride,
        daily_index_bytes_limit: indexBytesOverride,
        effective_daily_limit:
          requestOverride ??
          (hasSubscription ? subscriptionRequest : fallbackRequest),
        effective_daily_index_bytes_limit:
          indexBytesOverride ??
          (hasSubscription ? subscriptionIndexBytes : fallbackIndexBytes),
        daily_limit_source:
          requestOverride !== null
            ? "admin_override"
            : hasSubscription
              ? "subscription"
              : fallbackSource,
        daily_index_bytes_limit_source:
          indexBytesOverride !== null
            ? "admin_override"
            : hasSubscription
              ? "subscription"
              : fallbackSource,
        base_tier: baseTier,
        subscription_plan_name: hasSubscription
          ? String(row.subscription_plan_name)
          : null,
      };
    });
  } finally {
    client.release();
  }
}

// 两个维度都为 null 时删除覆盖；0 = 不限；正整数 = 每日上限。
export async function setUserQuota(
  userId: string,
  requestLimit: number | null,
  indexBytesLimit: number | null
) {
  const client = await pool.connect();
  let inheritedOrgIds: string[] = [];
  try {
    await client.query("BEGIN");
    try {
      if (requestLimit === null && indexBytesLimit === null) {
        await client.query(`DELETE FROM user_quotas WHERE user_id = $1`, [userId]);
      } else {
        await client.query(
          `INSERT INTO user_quotas (
             user_id, daily_limit, daily_index_bytes_limit
           ) VALUES ($1, $2, $3)
           ON CONFLICT (user_id) DO UPDATE SET
             daily_limit = EXCLUDED.daily_limit,
             daily_index_bytes_limit = EXCLUDED.daily_index_bytes_limit,
             updated_at = NOW()`,
          [userId, requestLimit, indexBytesLimit]
        );
      }

      // Relay lets organizations with a NULL org_quotas dimension inherit the
      // canonical owner's user_quotas value. Invalidate every organization for
      // which this user is actually the canonical owner, otherwise Relay can
      // enforce the old inherited value until its five-minute cache expires.
      const owned = await client.query(
        `WITH ranked_owners AS (
           SELECT members."organizationId" AS organization_id,
                  members."userId" AS owner_user_id,
                  ROW_NUMBER() OVER (
                    PARTITION BY members."organizationId"
                    ORDER BY members."createdAt", members.id
                  ) AS owner_rank
             FROM "member" AS members
            WHERE (',' || regexp_replace(members.role, '\\s', '', 'g') || ',') LIKE '%,owner,%'
         )
         SELECT organization_id
           FROM ranked_owners
          WHERE owner_rank = 1 AND owner_user_id = $1`,
        [userId]
      );
      inheritedOrgIds = owned.rows.map((row) => String(row.organization_id));
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
  await Promise.all([
    deleteQuotaLimitCache(userId),
    ...inheritedOrgIds.map((orgId) => deleteOrgQuotaCache(orgId)),
  ]);
}

// ── 日志清理 ─────────────────────────────────────────────────────────────

// olderThanDays: undefined = 全部清空。完整清理使用 TRUNCATE，按时间清理使用事务内 DELETE。
// error_details 与 request_logs 必须在同一事务处理，汇总表由 request_logs 触发器同步维护。
export async function clearRequestLogs(olderThanDays?: number): Promise<number> {
  const client = await pool.connect();
  try {
    const hasCutoff = typeof olderThanDays === "number" && olderThanDays > 0;
    await client.query("BEGIN");
    try {
      if (!hasCutoff) {
        // Avoid firing per-row rollup triggers for a full purge. The AFTER TRUNCATE
        // trigger on request_logs clears both aggregate tables in the same transaction.
        const countResult = await client.query(
          `SELECT COALESCE(SUM(total_count), 0)::bigint AS count
             FROM request_log_user_stats`
        );
        await client.query("TRUNCATE TABLE error_details, request_logs");
        await client.query("COMMIT");
        return Number(countResult.rows[0]?.count || 0);
      }

      const days = Math.floor(olderThanDays!);
      const cond = `WHERE request_timestamp < NOW() - INTERVAL '1 day' * $1`;
      await client.query(
        `DELETE FROM error_details WHERE request_id IN (
           SELECT id FROM request_logs ${cond}
         )`,
        [days]
      );
      const result = await client.query(`DELETE FROM request_logs ${cond}`, [days]);
      await client.query("COMMIT");
      return result.rowCount || 0;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  } finally {
    client.release();
  }
}
