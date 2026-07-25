import pool, {
  deleteBannedCache,
  deleteDeviceRegCache,
  deleteQuotaLimitCache,
  resetApiKey,
} from "@/lib/db";

// 统计/配额里的“今天”统一按 Asia/Shanghai 自然日，与 relay 配额计数、
// leaderboard 口径一致。
const TZ = "Asia/Shanghai";

// 管理端聚合查询。调用方（/api/admin/*）必须先通过 requireAdminSession。

export interface AdminOverview {
  users: number;
  devices: number;
  banned: number;
  totalRequests: number;
  requests24h: number;
  activeUsers24h: number;
  errors24h: number;
  alerts24h: number;
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM "user") AS users,
        (SELECT COUNT(*) FROM devices) AS devices,
        (SELECT COUNT(*) FROM banned_users) AS banned,
        (SELECT COUNT(*) FROM request_logs) AS total_requests,
        (SELECT COUNT(*) FROM request_logs
          WHERE request_timestamp > NOW() - INTERVAL '24 hours') AS requests_24h,
        (SELECT COUNT(DISTINCT user_id) FROM request_logs
          WHERE request_timestamp > NOW() - INTERVAL '24 hours') AS active_users_24h,
        (SELECT COUNT(*) FROM request_logs
          WHERE request_timestamp > NOW() - INTERVAL '24 hours'
            AND (status_code >= 400 OR status = 'error')) AS errors_24h,
        (SELECT COUNT(*) FROM device_alerts
          WHERE created_at > NOW() - INTERVAL '24 hours') AS alerts_24h
    `);
    const r = result.rows[0];
    return {
      users: parseInt(r.users),
      devices: parseInt(r.devices),
      banned: parseInt(r.banned),
      totalRequests: parseInt(r.total_requests),
      requests24h: parseInt(r.requests_24h),
      activeUsers24h: parseInt(r.active_users_24h),
      errors24h: parseInt(r.errors_24h),
      alerts24h: parseInt(r.alerts_24h),
    };
  } finally {
    client.release();
  }
}

export interface AdminAlertRow {
  id: number;
  user_id: string;
  email: string | null;
  device_id: string | null;
  kind: string;
  detail: string | null;
  created_at: Date;
}

export async function listRecentAlerts(limit = 30): Promise<AdminAlertRow[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT a.id, a.user_id, u.email, a.device_id, a.kind, a.detail, a.created_at
       FROM device_alerts a
       LEFT JOIN "user" u ON u.id = a.user_id
       ORDER BY a.created_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
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
  device_count: number;
  banned: boolean;
}

export async function listUsersWithStats(): Promise<AdminUserRow[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT u.id, u.email, u.name, u."createdAt" AS created_at,
        COALESCE(r.total, 0)::bigint AS request_count,
        r.last_at AS last_request_at,
        COALESCE(d.cnt, 0)::int AS device_count,
        (b.user_id IS NOT NULL) AS banned
      FROM "user" u
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS total, MAX(request_timestamp) AS last_at
        FROM request_logs GROUP BY user_id
      ) r ON r.user_id = u.id
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS cnt FROM devices GROUP BY user_id
      ) d ON d.user_id = u.id
      LEFT JOIN banned_users b ON b.user_id = u.id
      ORDER BY r.last_at DESC NULLS LAST, u."createdAt" DESC
    `);
    return result.rows.map((r) => ({
      ...r,
      request_count: parseInt(r.request_count),
    }));
  } finally {
    client.release();
  }
}

export interface AdminUserDetail {
  devices: {
    device_id: string;
    device_name: string | null;
    created_at: Date;
    last_seen_at: Date;
    last_ip: string | null;
  }[];
  alerts: AdminAlertRow[];
}

export async function getUserAdminDetail(userId: string): Promise<AdminUserDetail> {
  const client = await pool.connect();
  try {
    const devices = await client.query(
      `SELECT device_id, device_name, created_at, last_seen_at, last_ip
       FROM devices WHERE user_id = $1 ORDER BY last_seen_at DESC`,
      [userId]
    );
    const alerts = await client.query(
      `SELECT id, user_id, NULL AS email, device_id, kind, detail, created_at
       FROM device_alerts WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 20`,
      [userId]
    );
    return { devices: devices.rows, alerts: alerts.rows };
  } finally {
    client.release();
  }
}

// 解绑设备：删除注册记录并清 relay 缓存；enforce 模式下该设备立即 401
export async function adminRemoveDevice(userId: string, deviceId: string) {
  const client = await pool.connect();
  try {
    await client.query(
      `DELETE FROM devices WHERE user_id = $1 AND device_id = $2`,
      [userId, deviceId]
    );
  } finally {
    client.release();
  }
  await deleteDeviceRegCache(userId, [deviceId]);
}

// 重置用户密钥：旧 token 立即失效（resetApiKey 内部会清 apikey 缓存）
export async function adminResetUserKey(userId: string) {
  return resetApiKey(userId);
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
       ORDER BY rl.request_timestamp DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

// ── 调用统计（token-cost tab 的真实数据源：请求量，无 token 计量）────────

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
        COUNT(*) FILTER (WHERE (request_timestamp AT TIME ZONE '${TZ}')::date
          = (NOW() AT TIME ZONE '${TZ}')::date) AS today,
        COUNT(*) FILTER (WHERE request_timestamp > NOW() - INTERVAL '30 days') AS last30d,
        COUNT(*) AS total
      FROM request_logs
    `);
    const daily = await client.query(`
      SELECT to_char((request_timestamp AT TIME ZONE '${TZ}')::date, 'YYYY-MM-DD') AS date,
             COUNT(*) AS count
      FROM request_logs
      WHERE request_timestamp > NOW() - INTERVAL '14 days'
      GROUP BY 1 ORDER BY 1
    `);
    const byPath = await client.query(`
      SELECT request_path AS path, COUNT(*) AS count
      FROM request_logs
      WHERE request_timestamp > NOW() - INTERVAL '30 days'
      GROUP BY 1 ORDER BY 2 DESC LIMIT 10
    `);
    const topUsers = await client.query(`
      SELECT rl.user_id, u.email, COUNT(*) AS count
      FROM request_logs rl
      LEFT JOIN "user" u ON u.id = rl.user_id
      WHERE rl.request_timestamp > NOW() - INTERVAL '30 days'
      GROUP BY rl.user_id, u.email ORDER BY 3 DESC LIMIT 10
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
}

export async function listQuotas(): Promise<QuotaRow[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT u.id AS user_id, u.email, q.daily_limit,
        COALESCE(t.cnt, 0)::int AS today_count
      FROM "user" u
      LEFT JOIN user_quotas q ON q.user_id = u.id
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS cnt FROM request_logs
        WHERE (request_timestamp AT TIME ZONE '${TZ}')::date
          = (NOW() AT TIME ZONE '${TZ}')::date
        GROUP BY user_id
      ) t ON t.user_id = u.id
      ORDER BY t.cnt DESC NULLS LAST, u."createdAt" DESC
    `);
    return result.rows;
  } finally {
    client.release();
  }
}

// limit: null = 恢复默认；0 = 不限；正整数 = 每日上限
export async function setUserQuota(userId: string, limit: number | null) {
  const client = await pool.connect();
  try {
    if (limit === null) {
      await client.query(`DELETE FROM user_quotas WHERE user_id = $1`, [userId]);
    } else {
      await client.query(
        `INSERT INTO user_quotas (user_id, daily_limit) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET daily_limit = $2, updated_at = NOW()`,
        [userId, limit]
      );
    }
  } finally {
    client.release();
  }
  await deleteQuotaLimitCache(userId);
}

// ── 日志/告警清理 ─────────────────────────────────────────────────────────

// olderThanDays: undefined = 全部清空。error_details 有外键，先删。
export async function clearRequestLogs(olderThanDays?: number): Promise<number> {
  const client = await pool.connect();
  try {
    const cond =
      olderThanDays && olderThanDays > 0
        ? `WHERE request_timestamp < NOW() - INTERVAL '1 day' * ${Math.floor(olderThanDays)}`
        : "";
    await client.query(`
      DELETE FROM error_details WHERE request_id IN (
        SELECT id FROM request_logs ${cond}
      )
    `);
    const result = await client.query(`DELETE FROM request_logs ${cond}`);
    return result.rowCount || 0;
  } finally {
    client.release();
  }
}

export async function clearDeviceAlerts(): Promise<number> {
  const client = await pool.connect();
  try {
    const result = await client.query(`DELETE FROM device_alerts`);
    return result.rowCount || 0;
  } finally {
    client.release();
  }
}
