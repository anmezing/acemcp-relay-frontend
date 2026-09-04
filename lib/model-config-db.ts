import pool, { initDB } from "@/lib/db";
import { encryptModelConfig, type UserModelConfig } from "@/lib/model-config-crypto";

export interface UserModelConfigRow {
  config_enc: string;
}

export async function getUserModelConfigRow(
  userId: string
): Promise<UserModelConfigRow | null> {
  await initDB();
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT config_enc FROM user_model_configs WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

export async function saveUserModelConfig(userId: string, config: UserModelConfig) {
  await initDB();
  const enc = encryptModelConfig(config);
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO user_model_configs (user_id, config_enc)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
         SET config_enc = EXCLUDED.config_enc, updated_at = NOW()`,
      [userId, enc]
    );
  } finally {
    client.release();
  }
}

export async function resetUserModelConfig(userId: string) {
  await initDB();
  const client = await pool.connect();
  try {
    await client.query(`DELETE FROM user_model_configs WHERE user_id = $1`, [userId]);
  } finally {
    client.release();
  }
}

export async function countUserModelConfigs(): Promise<number> {
  await initDB();
  const client = await pool.connect();
  try {
    const result = await client.query(`SELECT COUNT(*) AS count FROM user_model_configs`);
    return parseInt(result.rows[0].count || "0");
  } finally {
    client.release();
  }
}
