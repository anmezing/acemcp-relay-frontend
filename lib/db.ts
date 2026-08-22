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

export interface DailyQuotaUsage {
  available: boolean;
  requestsUsed: number | null;
  indexBytesUsed: number | null;
  resetAt: string;
}

function shanghaiQuotaWindow(now: Date): { day: string; resetAt: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const year = Number(value("year"));
  const month = Number(value("month"));
  const dayOfMonth = Number(value("day"));
  const resetAt = new Date(
    Date.UTC(year, month - 1, dayOfMonth + 1, 0, 0, 0) - 8 * 60 * 60 * 1000
  );
  return {
    day: `${String(year).padStart(4, "0")}${String(month).padStart(2, "0")}${String(dayOfMonth).padStart(2, "0")}`,
    resetAt: resetAt.toISOString(),
  };
}

function parseQuotaCounter(value: string | null): number {
  if (value === null) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export async function getDailyQuotaUsage(
  tenantId: string,
  now = new Date()
): Promise<DailyQuotaUsage> {
  const window = shanghaiQuotaWindow(now);
  try {
    const redis = await getRedisClient();
    const [requests, indexBytes] = await redis.mGet([
      `quota:used:${tenantId}:${window.day}`,
      `quota:indexbytes:${tenantId}:${window.day}`,
    ]);
    return {
      available: true,
      requestsUsed: parseQuotaCounter(requests),
      indexBytesUsed: parseQuotaCounter(indexBytes),
      resetAt: window.resetAt,
    };
  } catch (error) {
    console.error(
      "Failed to load daily quota usage:",
      error instanceof Error ? error.message : "UNKNOWN"
    );
    return {
      available: false,
      requestsUsed: null,
      indexBytesUsed: null,
      resetAt: window.resetAt,
    };
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
    await redis.del([
      `quota:limit:${userId}`,
      `quota:limit:indexbytes:${userId}`
    ]);
  } catch (error) {
    console.error("Failed to delete quota limit cache:", error);
  }
}

// 删除组织成员配额缓存。key 的摘要输入与 relay 的 memberQuotaLimitCacheKey
// 完全一致，使用 NUL 分隔避免 (org, user) 拼接歧义。
export async function deleteOrgMemberQuotaCache(orgId: string, userId: string) {
  try {
    const redis = await getRedisClient();
    const digest = crypto
      .createHash("sha256")
      .update(`${orgId}\0${userId}`)
      .digest("hex");
    await redis.del(`quota:limit:member:${digest}`);
  } catch (error) {
    console.error("Failed to delete organization member quota cache:", error);
  }
}

export async function deleteOrgQuotaCache(orgId: string) {
  try {
    const redis = await getRedisClient();
    await redis.del(`quota:limit:orgq:${orgId}`);
  } catch (error) {
    console.error("Failed to delete organization quota cache:", error);
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
let dbInitialization: Promise<void> | undefined;

// Serialize the first request's migration work. Without this single-flight
// guard, concurrent cold-start requests can race between inspection and ALTER
// or constraint creation even though each individual statement is intended to
// be idempotent.
export function initDB(): Promise<void> {
  if (dbInitialized) return Promise.resolve();
  if (!dbInitialization) {
    dbInitialization = initializeDB().finally(() => {
      dbInitialization = undefined;
    });
  }
  return dbInitialization;
}

async function initializeDB() {
  if (dbInitialized) return;

  const client = await pool.connect();
  let migrationLockAcquired = false;
  try {
    // 进程内 single-flight 不能覆盖多副本/滚动发布；用数据库会话锁把
    // 检查、DDL、触发器重建串起来，避免多个实例交错迁移。
    await client.query(`
      SELECT pg_advisory_lock(hashtext('acemcp:frontend-schema'))
    `);
    migrationLockAcquired = true;

    // Check if api_keys table exists
    const apiKeysTableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'api_keys'
      )
    `);

    if (!apiKeysTableExists.rows[0].exists) {
      // 一人多密钥模型：个人密钥 org_id/org_role 为 NULL；组织密钥每
      // (user, org) 唯一。relay 契约：tenant := org_id ?? user_id。
      await client.query(`
        CREATE TABLE IF NOT EXISTS api_keys (
          id VARCHAR(64) PRIMARY KEY,
          user_id VARCHAR(255) NOT NULL,
          api_key VARCHAR(64) UNIQUE NOT NULL,
          tier TEXT NOT NULL DEFAULT 'free',
          org_id TEXT,
          org_role TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log("API keys table created");
    } else {
      // 存量表 id 为 VARCHAR(32)（MD5 时代），SHA-256 hex 需要 64 位。幂等放宽。
      await client.query(`ALTER TABLE api_keys ALTER COLUMN id TYPE VARCHAR(64)`);
    }

    // tier 分层（'free' | 'pro'），与 relay 侧契约一致：relay 认证缓存每 30 秒
    // 刷新读取，改 tier 后半分钟内生效。幂等迁移，存量表补列。
    await client.query(
      `ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'free'`
    );

    // 多密钥迁移：补 org 双列，去掉"一人一 key"约束，改为
    // 个人 key（org_id IS NULL）每人一把 + 组织 key 每 (user, org) 一把。
    await client.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS org_id TEXT`);
    await client.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS org_role TEXT`);
    await client.query(`ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_user_id_key`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS api_keys_personal_uniq
        ON api_keys (user_id) WHERE org_id IS NULL
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS api_keys_user_org_uniq
        ON api_keys (user_id, org_id) WHERE org_id IS NOT NULL
    `);

    // Better Auth organization 插件表（camelCase 与 better-auth CLI 生成的
    // user/session 表保持一致口径）。user/session 由 better-auth 建表，这里
    // 不对其加外键（初始化顺序不保证）。
    await client.query(`
      CREATE TABLE IF NOT EXISTS "organization" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "slug" TEXT NOT NULL UNIQUE,
        "logo" TEXT,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "metadata" TEXT
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS "member" (
        "id" TEXT PRIMARY KEY,
        "organizationId" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
        "userId" TEXT NOT NULL,
        "role" TEXT NOT NULL DEFAULT 'member',
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS "invitation" (
        "id" TEXT PRIMARY KEY,
        "organizationId" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
        "email" TEXT NOT NULL,
        "role" TEXT,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "expiresAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "inviterId" TEXT NOT NULL
      )
    `);
    // 组织插件需要 session.activeOrganizationId；session 表由 better-auth
    // 创建，可能尚不存在（全新库首个请求），存在时才补列。
    const sessionExists = await client.query(
      `SELECT to_regclass('public.session') IS NOT NULL AS ok`
    );
    if (sessionExists.rows[0].ok) {
      await client.query(
        `ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "activeOrganizationId" TEXT`
      );
    }

    // 组织共享配额池（平台管理员写，relay 读）。跨仓库契约 DDL；旧版 Relay
    // 可能已经建成 NOT NULL/default，必须幂等放宽才能支持 null=继承默认。
    await client.query(`
      CREATE TABLE IF NOT EXISTS org_quotas (
        org_id TEXT PRIMARY KEY,
        daily_request_limit BIGINT,
        daily_index_bytes_limit BIGINT,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      ALTER TABLE org_quotas
        ALTER COLUMN daily_request_limit DROP NOT NULL,
        ALTER COLUMN daily_request_limit DROP DEFAULT,
        ALTER COLUMN daily_index_bytes_limit DROP NOT NULL,
        ALTER COLUMN daily_index_bytes_limit DROP DEFAULT
    `);

    // 组织 owner 设置的成员上限按 (org, user) 隔离；个人 user_quotas 保持独立。
    // DDL 与 relay migrateQuotaTables 完全一致。
    await client.query(`
      CREATE TABLE IF NOT EXISTS org_member_quotas (
        org_id TEXT NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        daily_limit INTEGER NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        PRIMARY KEY (org_id, user_id)
      )
    `);

    // Better Auth 的成员表是组织授权的权威来源。先清理历史孤儿，再用外键让
    // 后续成员/组织删除与组织密钥、成员配额在 PostgreSQL 内原子级联。
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS member_org_user_uniq
        ON "member" ("organizationId", "userId")
    `);
    await client.query(`
      DELETE FROM api_keys AS keys
      WHERE keys.org_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "member" AS members
          WHERE members."organizationId" = keys.org_id
            AND members."userId" = keys.user_id
        )
    `);
    await client.query(`
      DELETE FROM org_member_quotas AS quotas
      WHERE NOT EXISTS (
        SELECT 1 FROM "member" AS members
        WHERE members."organizationId" = quotas.org_id
          AND members."userId" = quotas.user_id
      )
    `);
    await client.query(`
      DELETE FROM org_quotas AS quotas
      WHERE NOT EXISTS (
        SELECT 1 FROM "organization" AS organizations
        WHERE organizations."id" = quotas.org_id
      )
    `);

    const addConstraintIfMissing = async (
      table: string,
      name: string,
      statement: string
    ) => {
      const existing = await client.query(
        `SELECT 1 FROM pg_constraint
         WHERE conrelid = $1::regclass AND conname = $2`,
        [table, name]
      );
      if (!existing.rows[0]) await client.query(statement);
    };
    await addConstraintIfMissing(
      "api_keys",
      "api_keys_member_fk",
      `ALTER TABLE api_keys
       ADD CONSTRAINT api_keys_member_fk
       FOREIGN KEY (org_id, user_id)
       REFERENCES "member" ("organizationId", "userId")
       ON DELETE CASCADE`
    );
    await addConstraintIfMissing(
      "org_member_quotas",
      "org_member_quotas_member_fk",
      `ALTER TABLE org_member_quotas
       ADD CONSTRAINT org_member_quotas_member_fk
       FOREIGN KEY (org_id, user_id)
       REFERENCES "member" ("organizationId", "userId")
       ON DELETE CASCADE`
    );
    await addConstraintIfMissing(
      "org_quotas",
      "org_quotas_organization_fk",
      `ALTER TABLE org_quotas
       ADD CONSTRAINT org_quotas_organization_fk
       FOREIGN KEY (org_id) REFERENCES "organization" ("id")
       ON DELETE CASCADE`
    );

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
        daily_limit INTEGER,
        daily_index_bytes_limit BIGINT,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      ALTER TABLE user_quotas
        ALTER COLUMN daily_limit DROP NOT NULL,
        ADD COLUMN IF NOT EXISTS daily_index_bytes_limit BIGINT
    `);

    // 付费套餐是可配置数据，不在迁移里伪造价格或额度。订单保留购买时的
    // plan_snapshot；后续管理员改套餐只影响新订单，不篡改已购买权益。
    await client.query(`
      CREATE TABLE IF NOT EXISTS billing_plans (
        id TEXT PRIMARY KEY,
        code VARCHAR(64) NOT NULL UNIQUE,
        name VARCHAR(120) NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        tier TEXT NOT NULL CHECK (tier IN ('free', 'pro')),
        price_fen BIGINT NOT NULL CHECK (price_fen >= 0),
        duration_days INTEGER NOT NULL CHECK (duration_days > 0),
        daily_request_limit BIGINT NOT NULL CHECK (daily_request_limit >= 0),
        daily_index_bytes_limit BIGINT NOT NULL CHECK (daily_index_bytes_limit >= 0),
        subaccount_limit INTEGER NOT NULL CHECK (subaccount_limit >= 0),
        active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS billing_orders (
        id TEXT PRIMARY KEY,
        order_no VARCHAR(64) NOT NULL UNIQUE,
        user_id VARCHAR(255) NOT NULL,
        plan_id TEXT NOT NULL REFERENCES billing_plans(id) ON DELETE RESTRICT,
        provider VARCHAR(16) NOT NULL CHECK (provider IN ('alipay', 'wechat')),
        status VARCHAR(16) NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'paid', 'closed', 'failed')),
        amount_fen BIGINT NOT NULL CHECK (amount_fen >= 0),
        currency CHAR(3) NOT NULL DEFAULT 'CNY',
        plan_snapshot JSONB NOT NULL,
        provider_trade_no VARCHAR(128),
        code_url TEXT,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        paid_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS billing_orders_provider_trade_uniq
        ON billing_orders (provider, provider_trade_no)
        WHERE provider_trade_no IS NOT NULL
    `);
    // 订阅列直接保存已购买快照，使 Relay 不依赖可变的 billing_plans 表。
    // expires_at 是唯一有效期判断；过期后请求自动回落，不需要清理定时任务。
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_subscriptions (
        user_id VARCHAR(255) PRIMARY KEY,
        plan_id TEXT NOT NULL,
        plan_name VARCHAR(120) NOT NULL,
        tier TEXT NOT NULL CHECK (tier IN ('free', 'pro')),
        daily_request_limit BIGINT NOT NULL CHECK (daily_request_limit >= 0),
        daily_index_bytes_limit BIGINT NOT NULL CHECK (daily_index_bytes_limit >= 0),
        subaccount_limit INTEGER NOT NULL CHECK (subaccount_limit >= 0),
        starts_at TIMESTAMP WITH TIME ZONE NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        source_order_id TEXT NOT NULL UNIQUE,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS user_subscriptions_active_idx
        ON user_subscriptions (user_id, expires_at)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS billing_orders_user_created_idx
        ON billing_orders (user_id, created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS billing_orders_pending_expiry_idx
        ON billing_orders (expires_at)
        WHERE status = 'pending'
    `);
    // organization 插件的 membershipLimit 负责返回友好错误；触发器使用同一
    // “套餐持有人名下全部组织中，除本人外的唯一账号”口径并加事务锁，兜住并发
    // 接受邀请或直接写 member 表造成的超卖。角色升级不能绕过席位限制；
    // 没有有效订阅时子账号上限为 0。
    await client.query(`
      CREATE OR REPLACE FUNCTION enforce_subscription_subaccount_limit()
      RETURNS TRIGGER AS $$
      DECLARE
        owner_user_id TEXT;
        seat_limit INTEGER;
        used_seats BIGINT;
        excluded_member_id TEXT;
        new_seat_cost INTEGER;
      BEGIN
        IF TG_OP = 'UPDATE' THEN
          excluded_member_id := OLD.id;
        ELSE
          excluded_member_id := NULL;
        END IF;

        SELECT candidate.user_id
          INTO owner_user_id
          FROM (
            SELECT m."userId" AS user_id, m."createdAt" AS created_at, m.id
              FROM "member" m
             WHERE m."organizationId" = NEW."organizationId"
               AND (
                 excluded_member_id IS NULL OR m.id <> excluded_member_id
               )
               AND 'owner' = ANY(
                 regexp_split_to_array(COALESCE(m.role, ''), '\\s*,\\s*')
               )
            UNION ALL
            SELECT NEW."userId", NEW."createdAt", NEW.id
             WHERE 'owner' = ANY(
               regexp_split_to_array(COALESCE(NEW.role, ''), '\\s*,\\s*')
             )
          ) candidate
         ORDER BY candidate.created_at, candidate.id
         LIMIT 1;

        IF owner_user_id IS NULL THEN
          RAISE EXCEPTION 'ORGANIZATION_OWNER_REQUIRED';
        END IF;

        PERFORM pg_advisory_xact_lock(
          hashtext('acemcp:subaccounts'),
          hashtext(owner_user_id)
        );

        SELECT s.subaccount_limit
          INTO seat_limit
          FROM user_subscriptions s
         WHERE s.user_id = owner_user_id
           AND s.starts_at <= NOW()
           AND s.expires_at > NOW();
        seat_limit := COALESCE(seat_limit, 0);

        WITH owned_organizations AS (
          SELECT DISTINCT ownership."organizationId" AS organization_id
            FROM "member" ownership
           WHERE ownership."userId" = owner_user_id
             AND (
               excluded_member_id IS NULL OR ownership.id <> excluded_member_id
             )
             AND 'owner' = ANY(
               regexp_split_to_array(COALESCE(ownership.role, ''), '\\s*,\\s*')
             )
          UNION
          SELECT NEW."organizationId"
           WHERE NEW."userId" = owner_user_id
             AND 'owner' = ANY(
               regexp_split_to_array(COALESCE(NEW.role, ''), '\\s*,\\s*')
             )
        )
        , existing_accounts AS (
          SELECT DISTINCT counted."userId" AS user_id
            FROM "member" counted
            JOIN owned_organizations owned
              ON owned.organization_id = counted."organizationId"
           WHERE counted."userId" <> owner_user_id
             AND (
               excluded_member_id IS NULL OR counted.id <> excluded_member_id
             )
        )
        SELECT
          COUNT(*),
          CASE
            WHEN NEW."userId" = owner_user_id THEN 0
            WHEN COUNT(*) FILTER (
              WHERE existing_accounts.user_id = NEW."userId"
            ) > 0 THEN 0
            ELSE 1
          END
          INTO used_seats, new_seat_cost
          FROM existing_accounts;

        IF used_seats + new_seat_cost > seat_limit THEN
          RAISE EXCEPTION 'SUBACCOUNT_LIMIT_REACHED';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await client.query(`
      DROP TRIGGER IF EXISTS member_subscription_subaccount_limit ON "member"
    `);
    await client.query(`
      CREATE TRIGGER member_subscription_subaccount_limit
      BEFORE INSERT OR UPDATE OF role, "organizationId", "userId" ON "member"
      FOR EACH ROW
      EXECUTE FUNCTION enforce_subscription_subaccount_limit()
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

    // request_logs 由 relay 建表并写入，tenant_id 列由 relay 迁移补充。
    // 组织用量报表按 (tenant_id, request_timestamp) 过滤，缺索引会全表扫，
    // 这里幂等补复合索引。表/列尚不存在（relay 未部署新版）时跳过，
    // initDB 每进程只跑一次，下次进程启动会再补。
    const tenantIdColumn = await client.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'request_logs'
        AND column_name = 'tenant_id'
    `);
    if (tenantIdColumn.rows[0]) {
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_request_logs_tenant_ts
          ON request_logs (tenant_id, request_timestamp)
      `);
    }

    dbInitialized = true;
  } finally {
    if (migrationLockAcquired) {
      await client
        .query(`
          SELECT pg_advisory_unlock(hashtext('acemcp:frontend-schema'))
        `)
        .catch(() => {});
    }
    client.release();
  }
}

export function generateApiKey(): { id: string; apiKey: string } {
  const apiKey = `lce_${crypto.randomBytes(20).toString("hex")}`;
  // SHA-256（64 位 hex）。relay 侧认证已双读 md5/sha256，存量 MD5 key 继续可用。
  const id = crypto.createHash("sha256").update(apiKey).digest("hex");
  return { id, apiKey };
}

export function getIdFromKey(apiKey: string): string {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

export async function lockUserCredentialsTx(client: PoolClient, userId: string): Promise<void> {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext('acemcp:user-credentials'), hashtext($1))`,
    [userId]
  );
}

// 个人密钥（org_id IS NULL）。组织密钥见 lib/org-db.ts。
export async function getApiKey(userId: string) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT * FROM api_keys WHERE user_id = $1 AND org_id IS NULL`,
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
      `SELECT * FROM api_keys WHERE user_id = $1 AND org_id IS NULL FOR UPDATE`,
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
      `SELECT id FROM api_keys WHERE user_id = $1 AND org_id IS NULL FOR UPDATE`,
      [userId]
    );
    oldKeyId = oldResult.rows[0]?.id ?? null;

    const { id, apiKey } = generateApiKey();
    const result = oldKeyId
      ? await client.query(
          `UPDATE api_keys
           SET id = $2, api_key = $3, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $1 AND org_id IS NULL
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

export async function getRegistrationLimit(): Promise<number | null> {
  const raw = await getSystemSetting("registration_max_users");
  if (!raw || raw.trim() === "0") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export async function countRegisteredUsers(): Promise<number> {
  const client = await pool.connect();
  try {
    const result = await client.query(`SELECT COUNT(*)::int AS count FROM "user"`);
    return Number(result.rows[0]?.count ?? 0);
  } finally { client.release(); }
}

export async function isRegistrationAtCapacity(): Promise<boolean> {
  const limit = await getRegistrationLimit();
  return limit !== null && (await countRegisteredUsers()) >= limit;
}

export function maskApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length < 12) return "lce_************************";
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
