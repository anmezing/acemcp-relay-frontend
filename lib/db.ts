import { Pool, PoolClient } from "pg";
import crypto from "crypto";
import { createClient, RedisClientType } from "redis";

const pool = new Pool({
  host: process.env.POSTGRES_HOST || "localhost",
  port: parseInt(process.env.POSTGRES_PORT || "5432"),
  user: process.env.POSTGRES_USER || "postgres",
  password: process.env.POSTGRES_PASSWORD || "",
  database: process.env.POSTGRES_DB || "postgres",
});

export default pool;

// 全局 Redis 客户端
let redisClient: RedisClientType | null = null;

async function getRedisClient(): Promise<RedisClientType> {
  if (!redisClient) {
    const host = process.env.REDIS_HOST || "localhost";
    const port = process.env.REDIS_PORT || "6379";
    redisClient = createClient({ url: `redis://${host}:${port}` });
    redisClient.on("error", (err) => console.error("Redis error:", err));
    await redisClient.connect();
  }
  return redisClient;
}

// 删除 API Key 缓存
async function deleteApiKeyCache(keyId: string) {
  try {
    const redis = await getRedisClient();
    await redis.del(`apikey:${keyId}`);
  } catch (error) {
    console.error("Failed to delete API key cache:", error);
  }
}

// 删除设备注册缓存（relay 侧以 device:reg:{userId}:{deviceId} 缓存校验结果，
// 注册/淘汰后删掉才能立即生效，键名与 acemcp-relay/devices.go 约定一致）
export async function deleteDeviceRegCache(userId: string, deviceIds: string[]) {
  if (deviceIds.length === 0) return;
  try {
    const redis = await getRedisClient();
    await redis.del(deviceIds.map((d) => `device:reg:${userId}:${d}`));
  } catch (error) {
    console.error("Failed to delete device reg cache:", error);
  }
}

// 删除封禁状态缓存（relay 侧以 banned:{userId} 缓存，封禁/解封后立即生效）
export async function deleteBannedCache(userId: string) {
  try {
    const redis = await getRedisClient();
    await redis.del(`banned:${userId}`);
  } catch (error) {
    console.error("Failed to delete banned cache:", error);
  }
}

// 删除配额上限缓存（relay 侧以 quota:limit:{userId} 缓存，改配额后立即生效）
export async function deleteQuotaLimitCache(userId: string) {
  try {
    const redis = await getRedisClient();
    await redis.del(`quota:limit:${userId}`);
  } catch (error) {
    console.error("Failed to delete quota limit cache:", error);
  }
}

// 删除模型配置缓存（relay 侧以 modelcfg:{userId} 缓存，保存后立即生效）
export async function deleteModelConfigCache(userId: string) {
  try {
    const redis = await getRedisClient();
    await redis.del(`modelcfg:${userId}`);
  } catch (error) {
    console.error("Failed to delete model config cache:", error);
  }
}

let dbInitialized = false;

export async function initDB() {
  if (dbInitialized) return;

  const client = await pool.connect();
  try {
    // Check if api_keys table exists
    const apiKeysTableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'api_keys'
      )
    `);

    if (!apiKeysTableExists.rows[0].exists) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS api_keys (
          id VARCHAR(32) PRIMARY KEY,
          user_id VARCHAR(255) NOT NULL,
          api_key VARCHAR(64) UNIQUE NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id)
        )
      `);
      console.log("API keys table created");
    }

    // 与 acemcp-relay 的 migrateDeviceTables 使用相同 DDL（双方都是 IF NOT EXISTS）
    await client.query(`
      CREATE TABLE IF NOT EXISTS devices (
        user_id VARCHAR(255) NOT NULL,
        device_id VARCHAR(128) NOT NULL,
        device_name VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        last_ip VARCHAR(45),
        PRIMARY KEY (user_id, device_id)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS device_alerts (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        device_id VARCHAR(128),
        kind VARCHAR(32) NOT NULL,
        detail TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS banned_users (
        user_id VARCHAR(255) PRIMARY KEY,
        reason TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    // 与 acemcp-relay 的 migrateQuotaTables 相同 DDL（daily_limit 0 = 不限）
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_quotas (
        user_id VARCHAR(255) PRIMARY KEY,
        daily_limit INTEGER NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key VARCHAR(64) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    // 与 acemcp-relay 的 migrateModelConfigTables 相同 DDL
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_model_configs (
        user_id VARCHAR(255) PRIMARY KEY,
        config_enc TEXT,
        fingerprint VARCHAR(80) NOT NULL,
        applied_fingerprint VARCHAR(80),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

    dbInitialized = true;
  } finally {
    client.release();
  }
}

function generateApiKey(): { id: string; apiKey: string } {
  const apiKey = `ace_${crypto.randomBytes(20).toString("hex")}`;
  const id = crypto.createHash("md5").update(apiKey).digest("hex");
  return { id, apiKey };
}

export function getIdFromKey(apiKey: string): string {
  return crypto.createHash("md5").update(apiKey).digest("hex");
}

export async function getApiKey(userId: string) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT * FROM api_keys WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

export async function createApiKey(userId: string) {
  const client = await pool.connect();
  try {
    const { id, apiKey } = generateApiKey();
    const result = await client.query(
      `INSERT INTO api_keys (id, user_id, api_key)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [id, userId, apiKey]
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

export async function resetApiKey(userId: string) {
  const client = await pool.connect();
  try {
    // 1. 获取旧 key 的 id (用于删除缓存)
    const oldResult = await client.query(
      `SELECT id FROM api_keys WHERE user_id = $1`,
      [userId]
    );
    const oldKeyId = oldResult.rows[0]?.id;

    // 2. 更新数据库生成新 key
    const { id, apiKey } = generateApiKey();
    const result = await client.query(
      `UPDATE api_keys
       SET id = $2, api_key = $3, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1
       RETURNING *`,
      [userId, id, apiKey]
    );

    // 3. 删除旧 key 的 Redis 缓存
    if (oldKeyId) {
      await deleteApiKeyCache(oldKeyId);
    }

    return result.rows[0];
  } finally {
    client.release();
  }
}

// Device binding (防账号共用)：默认单设备互踢 —— 任何时刻只有最后登录的
// 设备有效，新设备登录即踢掉旧设备（换设备无感，共用则互相踢下线）。
const MAX_DEVICES_PER_USER = parseInt(process.env.MAX_DEVICES_PER_USER || "1");

export interface DeviceRow {
  user_id: string;
  device_id: string;
  device_name: string | null;
  created_at: Date;
  last_seen_at: Date;
  last_ip: string | null;
}

// 注册设备；超出上限时淘汰最久未活跃的设备（被淘汰设备在 relay enforce
// 模式下会收到 401，需要重新登录 —— 这正是共用账号时互踢的效果）。
// 只能在 deviceLogin 的事务里调用：注册、淘汰必须和 token 轮换同一事务提交。
async function registerDeviceTx(
  client: PoolClient,
  userId: string,
  deviceId: string,
  deviceName: string | null
): Promise<{ evicted: string[] }> {
  await client.query(
    `INSERT INTO devices (user_id, device_id, device_name, last_seen_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, device_id)
     DO UPDATE SET device_name = COALESCE($3, devices.device_name), last_seen_at = NOW()`,
    [userId, deviceId, deviceName]
  );

  const evictResult = await client.query(
    `DELETE FROM devices
     WHERE user_id = $1
       AND device_id NOT IN (
         SELECT device_id FROM devices
         WHERE user_id = $1
         ORDER BY last_seen_at DESC
         LIMIT $2
       )
     RETURNING device_id`,
    [userId, MAX_DEVICES_PER_USER]
  );
  const evicted = evictResult.rows.map((r: { device_id: string }) => r.device_id);

  if (evicted.length > 0) {
    // 每次踢出都留痕：单设备互踢下，频繁的 device_evicted 就是账号共用的信号。
    // 留痕是 best-effort：失败只回滚告警本身，不影响注册和淘汰。
    await client.query("SAVEPOINT device_alerts");
    try {
      for (const evictedId of evicted) {
        await client.query(
          `INSERT INTO device_alerts (user_id, device_id, kind, detail)
           VALUES ($1, $2, 'device_evicted', $3)`,
          [userId, evictedId, `replaced by ${deviceId}`]
        );
      }
      await client.query("RELEASE SAVEPOINT device_alerts");
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT device_alerts");
      console.error("Failed to record device eviction alert:", error);
    }
    console.log(
      `Device limit reached for user ${userId}: evicted ${evicted.join(", ")}`
    );
  }
  return { evicted };
}

export async function getDevices(userId: string): Promise<DeviceRow[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT user_id, device_id, device_name, created_at, last_seen_at, last_ip
       FROM devices
       WHERE user_id = $1
       ORDER BY last_seen_at DESC`,
      [userId]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

// 设备登录入口：注册设备 + 签发 API key。
// 轮换规则：仅当单设备模式（MAX_DEVICES_PER_USER=1）且这次登录踢掉了另一台
// 设备时才轮换 token —— 被踢机器上的旧 token（含被复制的副本）立即失效。
// 同一台机器的重复登录（多个 IDE / 多窗口 profile / 重装，machineId 相同）
// 不发生淘汰，返回当前 token，因此同机多 IDE 各自登录后共用同一个有效 token，
// 不会互相打死。多设备模式下永不轮换（会误伤其他在册设备）。
// 注册、淘汰、轮换在同一事务里，并按用户加 advisory 锁串行化并发登录：
// 否则两次并发登录可能互相淘汰后各自轮换，其中一方拿到的 token 已经失效。
export async function deviceLogin(
  userId: string,
  deviceId: string | null,
  deviceName: string | null
) {
  const client = await pool.connect();
  let evicted: string[] = [];
  let oldKeyId: string | null = null;
  let keyRecord;
  let rotated = false;
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext('acemcp:device-login'), hashtext($1))`,
      [userId]
    );

    if (deviceId) {
      // 注册失败不阻断登录：relay 在 log 模式下放行；enforce 模式下该设备
      // 会 401，用户重新登录即可重试注册。
      await client.query("SAVEPOINT device_reg");
      try {
        evicted = (await registerDeviceTx(client, userId, deviceId, deviceName)).evicted;
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT device_reg");
        evicted = [];
        console.error("Failed to register device:", error);
      }
    }

    const existing = await client.query(
      `SELECT * FROM api_keys WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );
    if (!existing.rows[0]) {
      const { id, apiKey } = generateApiKey();
      const created = await client.query(
        `INSERT INTO api_keys (id, user_id, api_key)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [id, userId, apiKey]
      );
      keyRecord = created.rows[0];
    } else if (MAX_DEVICES_PER_USER === 1 && evicted.length > 0) {
      oldKeyId = existing.rows[0].id;
      const { id, apiKey } = generateApiKey();
      const updated = await client.query(
        `UPDATE api_keys
         SET id = $2, api_key = $3, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1
         RETURNING *`,
        [userId, id, apiKey]
      );
      keyRecord = updated.rows[0];
      rotated = true;
    } else {
      keyRecord = existing.rows[0];
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  // 缓存失效必须在 COMMIT 之后：提交前删缓存会被并发请求用旧数据回填
  if (deviceId) {
    await deleteDeviceRegCache(userId, [deviceId, ...evicted]);
  }
  if (oldKeyId) {
    await deleteApiKeyCache(oldKeyId);
  }
  return { keyRecord, evicted, rotated };
}

export async function isUserBanned(userId: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT 1 FROM banned_users WHERE user_id = $1`,
      [userId]
    );
    return result.rows.length > 0;
  } finally {
    client.release();
  }
}

// 系统设置读写。读失败（如表尚未创建）时返回 null，调用方按默认值处理，
// 避免设置能力故障演变成登录/注册不可用。
export async function getSystemSetting(key: string): Promise<string | null> {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT value FROM system_settings WHERE key = $1`,
        [key]
      );
      return result.rows[0]?.value ?? null;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error(`Failed to read system setting ${key}:`, error);
    return null;
  }
}

export async function setSystemSetting(key: string, value: string) {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO system_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, value]
    );
  } finally {
    client.release();
  }
}

// 注册开关（system_settings.registration_enabled，缺省视为开放）
export async function isRegistrationDisabled(): Promise<boolean> {
  return (await getSystemSetting("registration_enabled")) === "false";
}

export function maskApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length < 12) return "ace_************************";
  const prefix = apiKey.slice(0, 8);
  const maskLength = apiKey.length - 8;
  return `${prefix}${"*".repeat(maskLength)}`;
}

// Request Logs functions
export interface RequestLogRow {
  id: string;
  user_id: string;
  status: string;
  status_code: number | null;
  request_path: string;
  request_method: string;
  request_timestamp: Date;
  response_duration_ms: number | null;
  client_ip: string;
}

export async function getRequestLogs(
  userId: string,
  limit: number = 20,
  offset: number = 0
): Promise<RequestLogRow[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, status, status_code, request_path, request_method,
              request_timestamp, response_duration_ms, client_ip
       FROM request_logs
       WHERE user_id = $1
       ORDER BY request_timestamp DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

export async function getRequestLogStats(userId: string): Promise<{
  successCount: number;
  failedCount: number;
  totalCount: number;
}> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE status_code >= 200 AND status_code < 400) as success_count,
         COUNT(*) FILTER (WHERE status_code >= 400 OR status = 'error') as failed_count,
         COUNT(*) as total_count
       FROM request_logs
       WHERE user_id = $1`,
      [userId]
    );
    return {
      successCount: parseInt(result.rows[0].success_count || "0"),
      failedCount: parseInt(result.rows[0].failed_count || "0"),
      totalCount: parseInt(result.rows[0].total_count || "0"),
    };
  } finally {
    client.release();
  }
}

// ContextEngine count
export async function getContextEngineCount(userId: string): Promise<number> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT COUNT(*) as count
       FROM request_logs
       WHERE user_id = $1
         AND request_path = '/agents/codebase-retrieval'
         AND status_code = 200`,
      [userId]
    );
    return parseInt(result.rows[0].count || "0");
  } finally {
    client.release();
  }
}

// Error Details functions
export interface ErrorDetailRow {
  id: number;
  request_id: string;
  source: string;
  error: string;
  created_at: Date;
}

export async function getRequestLogById(
  userId: string,
  logId: string
): Promise<RequestLogRow | null> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, status, status_code, request_path, request_method,
              request_timestamp, response_duration_ms, client_ip
       FROM request_logs
       WHERE id = $1 AND user_id = $2`,
      [logId, userId]
    );
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

export async function getErrorDetailsByRequestId(
  requestId: string
): Promise<ErrorDetailRow[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, request_id, source, error, created_at
       FROM error_details
       WHERE request_id = $1
       ORDER BY created_at ASC`,
      [requestId]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

// Health Check functions (read-only, Go backend writes data)
export interface HealthCheckRow {
  id: number;
  status: string;
  tcp_ping_ms: number | null;
  codebase_retrieval_ms: number | null;
  error_message: string | null;
  created_at: Date;
  next_check_at: Date | null;
}

export async function getHealthCheckHistory(
  limit: number = 60
): Promise<HealthCheckRow[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, status, tcp_ping_ms, codebase_retrieval_ms, error_message, created_at, next_check_at
       FROM health_checks
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

export async function getHealthCheckStats(days: number = 7): Promise<{
  successCount: number;
  totalCount: number;
}> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'success') as success_count,
         COUNT(*) as total_count
       FROM health_checks
       WHERE created_at >= NOW() - INTERVAL '1 day' * $1`,
      [days]
    );
    return {
      successCount: parseInt(result.rows[0].success_count || "0"),
      totalCount: parseInt(result.rows[0].total_count || "0"),
    };
  } finally {
    client.release();
  }
}

// Leaderboard functions
export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  user_name: string;
  request_count: number;
}

export async function getLeaderboard(dateStr?: string): Promise<LeaderboardEntry[]> {
  const client = await pool.connect();
  try {
    // Calculate today's date in Asia/Shanghai timezone if not provided
    const targetDate = dateStr || new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Shanghai'
    }).format(new Date());

    const result = await client.query(
      `SELECT l.rank, l.user_id, l.request_count, u.name as user_name
       FROM leaderboard l
       LEFT JOIN "user" u ON l.user_id = u.id
       WHERE l.date_str = $1
       ORDER BY l.rank ASC
       LIMIT 10`,
      [targetDate]
    );
    return result.rows;
  } finally {
    client.release();
  }
}
