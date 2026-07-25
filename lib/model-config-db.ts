import pool, { deleteModelConfigCache } from "@/lib/db";
import {
  DEFAULT_FINGERPRINT,
  encryptModelConfig,
  modelConfigFingerprint,
  type UserModelConfig,
} from "@/lib/model-config-crypto";

export interface UserModelConfigRow {
  config_enc: string | null;
  fingerprint: string;
  applied_fingerprint: string | null;
}

export async function getUserModelConfigRow(
  userId: string
): Promise<UserModelConfigRow | null> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT config_enc, fingerprint, applied_fingerprint
       FROM user_model_configs WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

// 保存自定义配置。applied_fingerprint 保持不变（新行记 'default' 表示
// "此前生效的是平台默认"）——relay 发现 fingerprint != applied_fingerprint
// 时会清空租户索引并推进 applied，插件随后自动全量重建。
export async function saveUserModelConfig(userId: string, config: UserModelConfig) {
  const enc = encryptModelConfig(config);
  const fingerprint = modelConfigFingerprint(config);
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO user_model_configs (user_id, config_enc, fingerprint, applied_fingerprint)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE
         SET config_enc = $2, fingerprint = $3, updated_at = NOW()`,
      [userId, enc, fingerprint, DEFAULT_FINGERPRINT]
    );
  } finally {
    client.release();
  }
  await deleteModelConfigCache(userId);
  return fingerprint;
}

// 恢复平台默认：清掉密文、指纹置哨兵值；relay 同样按指纹变化清索引重建
export async function resetUserModelConfig(userId: string) {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE user_model_configs
       SET config_enc = NULL, fingerprint = $2, updated_at = NOW()
       WHERE user_id = $1`,
      [userId, DEFAULT_FINGERPRINT]
    );
  } finally {
    client.release();
  }
  await deleteModelConfigCache(userId);
}

export async function countUserModelConfigs(): Promise<number> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT COUNT(*) AS count FROM user_model_configs WHERE config_enc IS NOT NULL`
    );
    return parseInt(result.rows[0].count || "0");
  } finally {
    client.release();
  }
}
