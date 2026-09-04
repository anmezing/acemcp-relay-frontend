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
    // Relay 对组织密钥逐请求校验动态成员关系和套餐席位。以下索引分别覆盖：
    // 1) 从 canonical owner 找其名下组织；2) 按组织确定最早 owner 及统计成员。
    // 避免套餐过期的严格授权校验退化为全 member 表扫描。
    await client.query(`
      CREATE INDEX IF NOT EXISTS member_user_org_idx
        ON "member" ("userId", "organizationId")
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS member_org_created_idx
        ON "member" ("organizationId", "createdAt", "id")
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
          CHECK (status IN ('pending', 'paid', 'closed', 'canceled', 'failed')),
        fulfillment_status VARCHAR(24) NOT NULL DEFAULT 'pending'
          CHECK (fulfillment_status IN ('pending', 'applied', 'manual_review')),
        fulfillment_error TEXT,
        fulfillment_effective_at TIMESTAMP WITH TIME ZONE,
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
      ALTER TABLE billing_orders
        ADD COLUMN IF NOT EXISTS fulfillment_status VARCHAR(24) NOT NULL DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS fulfillment_error TEXT,
        ADD COLUMN IF NOT EXISTS fulfillment_effective_at TIMESTAMP WITH TIME ZONE
    `);
    // Active cancellation is distinct from timeout closure: canceled is terminal,
    // while closed can still receive a provider callback that was delayed in transit.
    // Avoid taking a recurring ALTER TABLE lock on every process start once the
    // production constraint already contains the current state-machine values.
    await client.query(`
      DO $$
      DECLARE
        current_definition TEXT;
      BEGIN
        SELECT pg_get_constraintdef(c.oid)
          INTO current_definition
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'public'
           AND t.relname = 'billing_orders'
           AND c.conname = 'billing_orders_status_check';

        IF current_definition IS NULL OR position('canceled' IN current_definition) = 0 THEN
          ALTER TABLE billing_orders
            DROP CONSTRAINT IF EXISTS billing_orders_status_check;
          ALTER TABLE billing_orders
            ADD CONSTRAINT billing_orders_status_check
            CHECK (status IN ('pending', 'paid', 'closed', 'canceled', 'failed'));
        END IF;
      END;
      $$
    `);
    await addConstraintIfMissing(
      "billing_orders",
      "billing_orders_fulfillment_status_check",
      `ALTER TABLE billing_orders
       ADD CONSTRAINT billing_orders_fulfillment_status_check
       CHECK (fulfillment_status IN ('pending', 'applied', 'manual_review'))`
    );
    // 旧版本中 paid 与订阅写入在同一事务，存量 paid 订单均视为已发放；
    // 新版本的 manual_review 不会被此幂等回填覆盖。
    await client.query(`
      UPDATE billing_orders
         SET fulfillment_status = 'applied', updated_at = NOW()
       WHERE status = 'paid' AND fulfillment_status = 'pending'
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS billing_orders_provider_trade_uniq
        ON billing_orders (provider, provider_trade_no)
        WHERE provider_trade_no IS NOT NULL
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS billing_orders_manual_review_idx
        ON billing_orders (updated_at DESC, id DESC)
        WHERE status = 'paid' AND fulfillment_status = 'manual_review'
    `);
    // Enforce one live checkout per user across all payment providers. Clean up
    // legacy duplicates deterministically before adding the partial unique index.
    await client.query(`
      UPDATE billing_orders
         SET status = 'closed', updated_at = NOW()
       WHERE status = 'pending' AND expires_at <= NOW()
    `);
    await client.query(`
      WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY user_id
                 ORDER BY created_at DESC, id DESC
               ) AS row_number
          FROM billing_orders
         WHERE status = 'pending'
      )
      UPDATE billing_orders AS orders
         SET status = 'closed', updated_at = NOW()
        FROM ranked
       WHERE orders.id = ranked.id
         AND ranked.row_number > 1
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS billing_orders_one_pending_per_user_uniq
        ON billing_orders (user_id)
        WHERE status = 'pending'
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
    await addConstraintIfMissing(
      "user_subscriptions",
      "user_subscriptions_valid_window_check",
      `ALTER TABLE user_subscriptions
       ADD CONSTRAINT user_subscriptions_valid_window_check
       CHECK (expires_at > starts_at) NOT VALID`
    );
    // NOT VALID keeps a legacy malformed row from blocking a production rollout,
    // while PostgreSQL still enforces the rule for every new/updated row. Validate
    // immediately when historical data is already clean; otherwise leave the bad
    // row inactive for explicit operator reconciliation instead of mutating paid time.
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM user_subscriptions WHERE expires_at <= starts_at
        ) THEN
          ALTER TABLE user_subscriptions
            VALIDATE CONSTRAINT user_subscriptions_valid_window_check;
        END IF;
      END;
      $$
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
    // organization 插件负责友好错误；数据库使用同一套 canonical owner 规则
    // （每个组织最早的 owner）作为最终一致性边界。约束触发器在事务结束时校验
    // INSERT/UPDATE/DELETE 的最终状态，因此所有权转移可以在一个事务中完成，
    // 同时不能通过删除 owner、移动成员或直接写表绕过全局共享席位上限。
    await client.query(`
      CREATE OR REPLACE FUNCTION enforce_subscription_subaccount_limit()
      RETURNS TRIGGER AS $$
      DECLARE
        affected_organization_ids TEXT[];
        affected_organization_id TEXT;
        owner_user_ids TEXT[] := ARRAY[]::TEXT[];
        owner_user_id TEXT;
        seat_limit INTEGER;
        used_seats BIGINT;
      BEGIN
        IF TG_OP = 'UPDATE'
           AND OLD.role IS NOT DISTINCT FROM NEW.role
           AND OLD."organizationId" IS NOT DISTINCT FROM NEW."organizationId"
           AND OLD."userId" IS NOT DISTINCT FROM NEW."userId"
           AND OLD."createdAt" IS NOT DISTINCT FROM NEW."createdAt"
           AND OLD.id IS NOT DISTINCT FROM NEW.id THEN
          RETURN NEW;
        END IF;

        IF TG_OP = 'INSERT' THEN
          affected_organization_ids := ARRAY[NEW."organizationId"];
        ELSIF TG_OP = 'DELETE' THEN
          -- Removing an ordinary member can only reduce usage. Owner removal must be
          -- checked because it can leave the organization ownerless or transfer its
          -- canonical ownership and shared seat pool to another account.
          IF NOT ('owner' = ANY(
            regexp_split_to_array(COALESCE(OLD.role, ''), '\\s*,\\s*')
          )) THEN
            RETURN OLD;
          END IF;
          affected_organization_ids := ARRAY[OLD."organizationId"];
        ELSIF OLD."organizationId" IS DISTINCT FROM NEW."organizationId" THEN
          affected_organization_ids := ARRAY[OLD."organizationId", NEW."organizationId"];
        ELSE
          affected_organization_ids := ARRAY[NEW."organizationId"];
        END IF;

        -- Serialize topology changes per organization before deriving canonical owners.
        FOR affected_organization_id IN
          SELECT DISTINCT affected.organization_id
            FROM unnest(affected_organization_ids) AS affected(organization_id)
           WHERE affected.organization_id IS NOT NULL
           ORDER BY affected.organization_id
        LOOP
          PERFORM pg_advisory_xact_lock(
            hashtext('acemcp:organization-membership'),
            hashtext(affected_organization_id)
          );
        END LOOP;

        FOR affected_organization_id IN
          SELECT DISTINCT affected.organization_id
            FROM unnest(affected_organization_ids) AS affected(organization_id)
           WHERE affected.organization_id IS NOT NULL
           ORDER BY affected.organization_id
        LOOP
          -- Cascading deletion of the organization itself must not be rejected.
          IF NOT EXISTS (
            SELECT 1 FROM "organization" o WHERE o.id = affected_organization_id
          ) THEN
            CONTINUE;
          END IF;

          SELECT m."userId"
            INTO owner_user_id
            FROM "member" m
           WHERE m."organizationId" = affected_organization_id
             AND 'owner' = ANY(
               regexp_split_to_array(COALESCE(m.role, ''), '\\s*,\\s*')
             )
           ORDER BY m."createdAt", m.id
           LIMIT 1;

          IF owner_user_id IS NULL THEN
            RAISE EXCEPTION 'ORGANIZATION_OWNER_REQUIRED';
          END IF;
          IF NOT (owner_user_id = ANY(owner_user_ids)) THEN
            owner_user_ids := array_append(owner_user_ids, owner_user_id);
          END IF;
        END LOOP;

        -- Sorted owner locks avoid deadlocks when a transaction transfers ownership
        -- between organizations belonging to different subscription holders.
        FOR owner_user_id IN
          SELECT owners.value
            FROM unnest(owner_user_ids) AS owners(value)
           ORDER BY owners.value
        LOOP
          PERFORM pg_advisory_xact_lock(
            hashtext('acemcp:subaccounts'),
            hashtext(owner_user_id)
          );
        END LOOP;

        FOR owner_user_id IN
          SELECT owners.value
            FROM unnest(owner_user_ids) AS owners(value)
           ORDER BY owners.value
        LOOP
          SELECT s.subaccount_limit
            INTO seat_limit
            FROM user_subscriptions s
           WHERE s.user_id = owner_user_id
             AND s.starts_at <= NOW()
             AND s.expires_at > NOW();
          seat_limit := COALESCE(seat_limit, 0);

          WITH canonical_ownership AS (
            SELECT organization_id, canonical_owner_id
              FROM (
                SELECT
                  m."organizationId" AS organization_id,
                  m."userId" AS canonical_owner_id,
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
          SELECT COUNT(DISTINCT counted."userId")
            INTO used_seats
            FROM canonical_ownership owned
            JOIN "member" counted
              ON counted."organizationId" = owned.organization_id
             AND counted."userId" <> owner_user_id
           WHERE owned.canonical_owner_id = owner_user_id;

          IF used_seats > seat_limit THEN
            RAISE EXCEPTION 'SUBACCOUNT_LIMIT_REACHED';
          END IF;
        END LOOP;

        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await client.query(`
      DROP TRIGGER IF EXISTS member_subscription_subaccount_limit ON "member"
    `);
    await client.query(`
      CREATE CONSTRAINT TRIGGER member_subscription_subaccount_limit
      AFTER INSERT OR UPDATE OR DELETE ON "member"
      DEFERRABLE INITIALLY DEFERRED
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
          ON request_logs (tenant_id, request_timestamp DESC)
      `);
    }
    const requestLogsTable = await client.query(`
      SELECT to_regclass('public.request_logs') IS NOT NULL AS ok
    `);
    if (requestLogsTable.rows[0]?.ok) {
      // 明细页按稳定倒序读取。精确总数和状态统计不在请求路径 COUNT(*)，
      // 而由下面的数据库触发器维护用户级汇总行。
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_request_logs_user_ts_id
          ON request_logs (user_id, request_timestamp DESC, id DESC)
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS frontend_schema_migrations (
          key TEXT PRIMARY KEY,
          applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS request_log_user_stats (
          user_id VARCHAR(255) PRIMARY KEY,
          total_count BIGINT NOT NULL DEFAULT 0 CHECK (total_count >= 0),
          success_count BIGINT NOT NULL DEFAULT 0 CHECK (success_count >= 0),
          failed_count BIGINT NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
          context_engine_count BIGINT NOT NULL DEFAULT 0 CHECK (context_engine_count >= 0),
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS request_log_daily_stats (
          stat_date DATE NOT NULL,
          user_id VARCHAR(255) NOT NULL,
          request_path VARCHAR(512) NOT NULL,
          total_count BIGINT NOT NULL DEFAULT 0 CHECK (total_count >= 0),
          success_count BIGINT NOT NULL DEFAULT 0 CHECK (success_count >= 0),
          failed_count BIGINT NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          PRIMARY KEY (stat_date, user_id, request_path)
        );
        CREATE INDEX IF NOT EXISTS idx_request_log_daily_stats_user_date
          ON request_log_daily_stats (user_id, stat_date DESC);

        CREATE OR REPLACE FUNCTION maintain_request_log_stats()
        RETURNS TRIGGER AS $$
        BEGIN
          IF TG_OP <> 'INSERT' THEN
            UPDATE request_log_user_stats
               SET total_count = GREATEST(total_count - 1, 0),
                   success_count = GREATEST(success_count - CASE
                     WHEN OLD.status_code >= 200 AND OLD.status_code < 400 AND OLD.status <> 'error' THEN 1 ELSE 0 END, 0),
                   failed_count = GREATEST(failed_count - CASE
                     WHEN OLD.status_code >= 400 OR OLD.status = 'error' THEN 1 ELSE 0 END, 0),
                   context_engine_count = GREATEST(context_engine_count - CASE
                     WHEN OLD.request_path = '/mcp/tools/call/codebase-retrieval'
                      AND OLD.status_code = 200 AND OLD.status <> 'error' THEN 1 ELSE 0 END, 0),
                   updated_at = NOW()
             WHERE user_id = OLD.user_id;
            DELETE FROM request_log_user_stats
             WHERE user_id = OLD.user_id AND total_count = 0;

            UPDATE request_log_daily_stats
               SET total_count = GREATEST(total_count - 1, 0),
                   success_count = GREATEST(success_count - CASE
                     WHEN OLD.status_code >= 200 AND OLD.status_code < 400 AND OLD.status <> 'error' THEN 1 ELSE 0 END, 0),
                   failed_count = GREATEST(failed_count - CASE
                     WHEN OLD.status_code >= 400 OR OLD.status = 'error' THEN 1 ELSE 0 END, 0),
                   updated_at = NOW()
             WHERE stat_date = (OLD.request_timestamp AT TIME ZONE 'Asia/Shanghai')::date
               AND user_id = OLD.user_id
               AND request_path = OLD.request_path;
            DELETE FROM request_log_daily_stats
             WHERE stat_date = (OLD.request_timestamp AT TIME ZONE 'Asia/Shanghai')::date
               AND user_id = OLD.user_id
               AND request_path = OLD.request_path
               AND total_count = 0;
          END IF;

          IF TG_OP <> 'DELETE' THEN
            INSERT INTO request_log_user_stats (
              user_id, total_count, success_count, failed_count,
              context_engine_count, updated_at
            ) VALUES (
              NEW.user_id,
              1,
              CASE WHEN NEW.status_code >= 200 AND NEW.status_code < 400
                     AND NEW.status <> 'error' THEN 1 ELSE 0 END,
              CASE WHEN NEW.status_code >= 400 OR NEW.status = 'error' THEN 1 ELSE 0 END,
              CASE WHEN NEW.request_path = '/mcp/tools/call/codebase-retrieval'
                     AND NEW.status_code = 200 AND NEW.status <> 'error' THEN 1 ELSE 0 END,
              NOW()
            )
            ON CONFLICT (user_id) DO UPDATE SET
              total_count = request_log_user_stats.total_count + EXCLUDED.total_count,
              success_count = request_log_user_stats.success_count + EXCLUDED.success_count,
              failed_count = request_log_user_stats.failed_count + EXCLUDED.failed_count,
              context_engine_count = request_log_user_stats.context_engine_count + EXCLUDED.context_engine_count,
              updated_at = NOW();

            INSERT INTO request_log_daily_stats (
              stat_date, user_id, request_path, total_count,
              success_count, failed_count, updated_at
            ) VALUES (
              (NEW.request_timestamp AT TIME ZONE 'Asia/Shanghai')::date,
              NEW.user_id,
              NEW.request_path,
              1,
              CASE WHEN NEW.status_code >= 200 AND NEW.status_code < 400
                     AND NEW.status <> 'error' THEN 1 ELSE 0 END,
              CASE WHEN NEW.status_code >= 400 OR NEW.status = 'error' THEN 1 ELSE 0 END,
              NOW()
            )
            ON CONFLICT (stat_date, user_id, request_path) DO UPDATE SET
              total_count = request_log_daily_stats.total_count + EXCLUDED.total_count,
              success_count = request_log_daily_stats.success_count + EXCLUDED.success_count,
              failed_count = request_log_daily_stats.failed_count + EXCLUDED.failed_count,
              updated_at = NOW();
          END IF;
          RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        CREATE OR REPLACE FUNCTION reset_request_log_stats()
        RETURNS TRIGGER AS $$
        BEGIN
          TRUNCATE TABLE request_log_user_stats, request_log_daily_stats;
          RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        DO $$
        BEGIN
          IF (
            SELECT COUNT(*)
              FROM pg_trigger
             WHERE tgrelid = 'request_logs'::regclass
               AND tgname = ANY (ARRAY[
                 'request_logs_rollup_insert_v3',
                 'request_logs_rollup_update_v3',
                 'request_logs_rollup_delete_v3',
                 'request_logs_rollup_truncate_v3'
               ])
               AND NOT tgisinternal
               -- Treat disabled or replica-only triggers as missing. Aggregate
               -- tables are authoritative for pagination/statistics, so merely
               -- finding four trigger names is insufficient if an operational
               -- change left one of them unable to fire for normal writes.
               AND tgenabled IN ('O', 'A')
          ) <> 4 THEN
            -- Replace legacy/incomplete trigger definitions once. Normal process
            -- restarts leave the installed triggers untouched and avoid taking a
            -- DDL lock on the hot request_logs table.
            DROP TRIGGER IF EXISTS request_logs_stats_insert ON request_logs;
            DROP TRIGGER IF EXISTS request_logs_stats_update ON request_logs;
            DROP TRIGGER IF EXISTS request_logs_stats_delete ON request_logs;
            DROP TRIGGER IF EXISTS request_logs_stats_truncate ON request_logs;
            DROP TRIGGER IF EXISTS request_logs_rollup_insert_v3 ON request_logs;
            DROP TRIGGER IF EXISTS request_logs_rollup_update_v3 ON request_logs;
            DROP TRIGGER IF EXISTS request_logs_rollup_delete_v3 ON request_logs;
            DROP TRIGGER IF EXISTS request_logs_rollup_truncate_v3 ON request_logs;
            CREATE TRIGGER request_logs_rollup_insert_v3
              AFTER INSERT ON request_logs
              FOR EACH ROW EXECUTE FUNCTION maintain_request_log_stats();
            CREATE TRIGGER request_logs_rollup_update_v3
              AFTER UPDATE OF user_id, status, status_code, request_path, request_timestamp ON request_logs
              FOR EACH ROW EXECUTE FUNCTION maintain_request_log_stats();
            CREATE TRIGGER request_logs_rollup_delete_v3
              AFTER DELETE ON request_logs
              FOR EACH ROW EXECUTE FUNCTION maintain_request_log_stats();
            CREATE TRIGGER request_logs_rollup_truncate_v3
              AFTER TRUNCATE ON request_logs
              FOR EACH STATEMENT EXECUTE FUNCTION reset_request_log_stats();

            -- A missing/disabled trigger means aggregate rows may already have
            -- drifted. Recreating future-write maintenance is not enough: force
            -- the guarded rebuild below to reconcile the historical interval.
            DELETE FROM frontend_schema_migrations
             WHERE key = 'request-log-stats-v3';
          END IF;
        END;
        $$;

        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM frontend_schema_migrations
             WHERE key = 'request-log-stats-v3'
          ) THEN
            -- Block concurrent writes while both aggregate tables are rebuilt.
            -- This is the only full historical scan; request paths read summaries.
            LOCK TABLE request_logs IN SHARE ROW EXCLUSIVE MODE;
            TRUNCATE TABLE request_log_user_stats, request_log_daily_stats;
            INSERT INTO request_log_user_stats (
              user_id, total_count, success_count, failed_count,
              context_engine_count, updated_at
            )
            SELECT user_id,
                   COUNT(*),
                   COUNT(*) FILTER (WHERE status_code >= 200 AND status_code < 400 AND status <> 'error'),
                   COUNT(*) FILTER (WHERE status_code >= 400 OR status = 'error'),
                   COUNT(*) FILTER (
                     WHERE request_path = '/mcp/tools/call/codebase-retrieval'
                       AND status_code = 200 AND status <> 'error'
                   ),
                   NOW()
              FROM request_logs
             GROUP BY user_id;
            INSERT INTO request_log_daily_stats (
              stat_date, user_id, request_path, total_count,
              success_count, failed_count, updated_at
            )
            SELECT (request_timestamp AT TIME ZONE 'Asia/Shanghai')::date,
                   user_id,
                   request_path,
                   COUNT(*),
                   COUNT(*) FILTER (WHERE status_code >= 200 AND status_code < 400 AND status <> 'error'),
                   COUNT(*) FILTER (WHERE status_code >= 400 OR status = 'error'),
                   NOW()
              FROM request_logs
             GROUP BY 1, user_id, request_path;
            INSERT INTO frontend_schema_migrations (key)
            VALUES ('request-log-stats-v3');
          END IF;
        END;
        $$;
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

const REGISTRATION_REMAINING_SLOTS_KEY = "registration_remaining_slots";
const LEGACY_REGISTRATION_MAX_USERS_KEY = "registration_max_users";
let registrationGateInitialized = false;
let registrationGateInitialization: Promise<void> | undefined;

/**
 * Install the database-side registration gate.
 *
 * The remaining-slot row is locked and decremented by a BEFORE INSERT trigger
 * in the same transaction that creates the Better Auth user. That makes the
 * quota authoritative under concurrent email/OAuth registrations; the
 * application-level check only exists to return a friendlier error early.
 */
export function initRegistrationGate(): Promise<void> {
  if (registrationGateInitialized) return Promise.resolve();
  if (!registrationGateInitialization) {
    registrationGateInitialization = initializeRegistrationGate().finally(() => {
      registrationGateInitialization = undefined;
    });
  }
  return registrationGateInitialization;
}

async function initializeRegistrationGate(): Promise<void> {
  if (registrationGateInitialized) return;

  const client = await pool.connect();
  let migrationLockAcquired = false;
  try {
    await client.query(`
      SELECT pg_advisory_lock(hashtext('acemcp:registration-gate-schema'))
    `);
    migrationLockAcquired = true;

    await client.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key VARCHAR(64) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

    // Better Auth owns the user table and may initialize it after an admin API
    // request. Do not mark the gate initialized until the trigger is installed;
    // a later user.create hook will retry.
    const userTable = await client.query(`
      SELECT to_regclass('public."user"') IS NOT NULL AS exists
    `);
    if (!userTable.rows[0]?.exists) return;

    // One-time compatibility migration from the old total-user ceiling:
    // remaining = max(old ceiling - users already registered, 0).
    // A previously written new-style value always wins.
    await client.query(
      `WITH legacy AS (
         SELECT CASE
                  WHEN value ~ '^[0-9]+$' THEN value::numeric
                  ELSE NULL
                END AS max_users
         FROM system_settings
         WHERE key = $2
       )
       INSERT INTO system_settings (key, value)
       SELECT $1,
              GREATEST(legacy.max_users - totals.registered_users, 0)::text
       FROM legacy
       CROSS JOIN (
         SELECT COUNT(*)::numeric AS registered_users FROM "user"
       ) AS totals
       WHERE legacy.max_users BETWEEN 1 AND 9007199254740991
       ON CONFLICT (key) DO NOTHING`,
      [REGISTRATION_REMAINING_SLOTS_KEY, LEGACY_REGISTRATION_MAX_USERS_KEY]
    );
    await client.query(
      `DELETE FROM system_settings WHERE key = $1`,
      [LEGACY_REGISTRATION_MAX_USERS_KEY]
    );

    await client.query(`
      CREATE OR REPLACE FUNCTION enforce_registration_gate()
      RETURNS TRIGGER AS $$
      DECLARE
        registration_state TEXT;
        remaining_value TEXT;
      BEGIN
        SELECT value INTO registration_state
        FROM system_settings
        WHERE key = 'registration_enabled';

        IF registration_state = 'false' THEN
          RAISE EXCEPTION USING
            ERRCODE = 'P0001',
            MESSAGE = 'REGISTRATION_DISABLED';
        END IF;

        SELECT value INTO remaining_value
        FROM system_settings
        WHERE key = 'registration_remaining_slots'
        FOR UPDATE;

        IF NOT FOUND THEN
          RETURN NEW;
        END IF;

        IF remaining_value !~ '^[0-9]+$' THEN
          RAISE EXCEPTION USING
            ERRCODE = 'P0001',
            MESSAGE = 'REGISTRATION_QUOTA_INVALID';
        END IF;

        IF remaining_value::bigint <= 0 THEN
          RAISE EXCEPTION USING
            ERRCODE = 'P0001',
            MESSAGE = 'REGISTRATION_LIMIT_REACHED';
        END IF;

        UPDATE system_settings
        SET value = (remaining_value::bigint - 1)::text,
            updated_at = NOW()
        WHERE key = 'registration_remaining_slots';

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await client.query(`
      DROP TRIGGER IF EXISTS user_registration_gate ON "user"
    `);
    await client.query(`
      CREATE TRIGGER user_registration_gate
      BEFORE INSERT ON "user"
      FOR EACH ROW
      EXECUTE FUNCTION enforce_registration_gate()
    `);

    registrationGateInitialized = true;
  } finally {
    if (migrationLockAcquired) {
      await client
        .query(`
          SELECT pg_advisory_unlock(hashtext('acemcp:registration-gate-schema'))
        `)
        .catch(() => {});
    }
    client.release();
  }
}

// null means unlimited; 0 means no new registrations remain.
export async function getRegistrationRemainingSlots(): Promise<number | null> {
  const raw = await getSystemSetting(REGISTRATION_REMAINING_SLOTS_KEY);
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) return 0;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** Reset the number of new registrations allowed from this save onward. */
export async function setRegistrationRemainingSlots(slots: number | null): Promise<void> {
  if (slots !== null && (!Number.isSafeInteger(slots) || slots < 0)) {
    throw new RangeError("registration slots must be a non-negative safe integer or null");
  }
  await initRegistrationGate();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (slots === null) {
      await client.query(
        `DELETE FROM system_settings WHERE key IN ($1, $2)`,
        [REGISTRATION_REMAINING_SLOTS_KEY, LEGACY_REGISTRATION_MAX_USERS_KEY]
      );
    } else {
      await client.query(
        `INSERT INTO system_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [REGISTRATION_REMAINING_SLOTS_KEY, String(slots)]
      );
      await client.query(
        `DELETE FROM system_settings WHERE key = $1`,
        [LEGACY_REGISTRATION_MAX_USERS_KEY]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function countRegisteredUsers(): Promise<number> {
  const client = await pool.connect();
  try {
    const result = await client.query(`SELECT COUNT(*)::int AS count FROM "user"`);
    return Number(result.rows[0]?.count ?? 0);
  } finally { client.release(); }
}

export async function isRegistrationAtCapacity(): Promise<boolean> {
  const remainingSlots = await getRegistrationRemainingSlots();
  return remainingSlots !== null && remainingSlots <= 0;
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
  await initDB();
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, status, status_code, request_path, request_method,
              request_timestamp, response_duration_ms, client_ip
       FROM request_logs
       WHERE user_id = $1
       ORDER BY request_timestamp DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

export async function countRequestLogs(userId: string): Promise<number> {
  await initDB();
  const result = await pool.query(
    `SELECT total_count FROM request_log_user_stats WHERE user_id = $1`,
    [userId]
  );
  return Number(result.rows[0]?.total_count ?? 0);
}

export async function getRequestLogStats(userId: string): Promise<{
  successCount: number;
  failedCount: number;
  totalCount: number;
  contextEngineCount: number;
}> {
  await initDB();
  const result = await pool.query(
    `SELECT success_count, failed_count, total_count, context_engine_count
       FROM request_log_user_stats
      WHERE user_id = $1`,
    [userId]
  );
  return {
    successCount: Number(result.rows[0]?.success_count ?? 0),
    failedCount: Number(result.rows[0]?.failed_count ?? 0),
    totalCount: Number(result.rows[0]?.total_count ?? 0),
    contextEngineCount: Number(result.rows[0]?.context_engine_count ?? 0),
  };
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
const LEADERBOARD_TIMEZONE = "Asia/Shanghai";
const LEADERBOARD_REQUEST_PATHS = [
  "/mcp/tools/call/codebase-retrieval",
  "/mcp/tools/call/codebase_enhance_prompt",
] as const;
const LEADERBOARD_REQUEST_PATHS_SQL = LEADERBOARD_REQUEST_PATHS.map(
  (path) => `'${path}'`
).join(", ");

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  user_name: string;
  request_count: number | string;
}

export function getShanghaiDateString(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: LEADERBOARD_TIMEZONE,
  }).format(now);
}

export function isValidLeaderboardDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function getLeaderboard(dateStr?: string): Promise<LeaderboardEntry[]> {
  const targetDate = dateStr || getShanghaiDateString();
  if (!isValidLeaderboardDate(targetDate)) {
    throw new RangeError("leaderboard date must use YYYY-MM-DD");
  }

  const client = await pool.connect();
  try {
    // request_logs remains the source of truth; request_log_daily_stats is maintained
    // transactionally by request-log triggers. Only successful retrieval and prompt-
    // enhancement calls count; indexing, symbol-graph, and protocol traffic do not.
    const result = await client.query(
      `WITH ranked AS (
         SELECT
           rl.user_id,
           u.name AS user_name,
           SUM(rl.success_count)::bigint AS request_count,
           ROW_NUMBER() OVER (
             ORDER BY SUM(rl.success_count) DESC, rl.user_id ASC
           )::int AS rank
         FROM request_log_daily_stats rl
         INNER JOIN "user" u ON u.id = rl.user_id
         WHERE rl.request_path IN (${LEADERBOARD_REQUEST_PATHS_SQL})
           AND rl.stat_date = $1::date
         GROUP BY rl.user_id, u.name
         HAVING SUM(rl.success_count) > 0
       )
       SELECT rank, user_id, user_name, request_count
       FROM ranked
       ORDER BY rank ASC
       LIMIT 10`,
      [targetDate]
    );
    return result.rows;
  } finally {
    client.release();
  }
}
