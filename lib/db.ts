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
        config_enc TEXT NOT NULL,
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

async function lockUserCredentialsTx(client: PoolClient, userId: string): Promise<void> {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext('acemcp:user-credentials'), hashtext($1))`,
    [userId]
  );
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
    await client.query("BEGIN");
    await lockUserCredentialsTx(client, userId);
    const existing = await client.query(
      `SELECT * FROM api_keys WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );
    if (existing.rows[0]) {
      await client.query("COMMIT");
      return existing.rows[0];
    }
    const { id, apiKey } = generateApiKey();
    const result = await client.query(
      `INSERT INTO api_keys (id, user_id, api_key)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [id, userId, apiKey]
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

export async function resetApiKey(userId: string) {
  const client = await pool.connect();
  let oldKeyId: string | null = null;
  let keyRecord;
  try {
    await client.query("BEGIN");
    await lockUserCredentialsTx(client, userId);
    const oldResult = await client.query(
      `SELECT id FROM api_keys WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );
    oldKeyId = oldResult.rows[0]?.id ?? null;

    const { id, apiKey } = generateApiKey();
    const result = oldKeyId
      ? await client.query(
          `UPDATE api_keys
           SET id = $2, api_key = $3, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $1
           RETURNING *`,
          [userId, id, apiKey]
        )
      : await client.query(
          `INSERT INTO api_keys (id, user_id, api_key)
           VALUES ($1, $2, $3)
           RETURNING *`,
          [id, userId, apiKey]
        );
    keyRecord = result.rows[0];
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  if (oldKeyId) {
    await deleteApiKeyCache(oldKeyId);
  }
  return keyRecord;
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
         AND request_path = '/mcp/tools/call/codebase-retrieval'
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
