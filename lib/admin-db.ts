import pool, {
  deleteBannedCache,
  deleteDeviceRegCache,
  resetApiKey,
} from "@/lib/db";

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
