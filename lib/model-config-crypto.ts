import crypto from "crypto";

import { ValidationError } from "./errors";
import { validateUserRerankProviderUrl } from "./safe-outbound";

// AES-256-GCM layout: base64(nonce[12] || ciphertext || tag[16]).
// Keep this format aligned with acemcp-relay/modelconfig.go.
export interface RerankModelConfig {
  provider: "siliconflow-compatible" | "voyage" | "custom";
  model: string;
  baseUrl: string;
  apiKey: string;
}

export interface UserModelConfig {
  rerank: RerankModelConfig;
}

export function modelConfigEnabled(): boolean {
  return !!process.env.MODEL_CONFIG_SECRET;
}

function encryptionKey(): Buffer {
  const secret = process.env.MODEL_CONFIG_SECRET;
  if (!secret) throw new Error("MODEL_CONFIG_SECRET is not set");
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptModelConfig(config: UserModelConfig): string {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(config), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ciphertext, tag]).toString("base64");
}

export function decryptModelConfig(enc: string): UserModelConfig {
  const data = Buffer.from(enc, "base64");
  if (data.length < 12 + 16) throw new Error("ciphertext too short");
  const nonce = data.subarray(0, 12);
  const tag = data.subarray(data.length - 16);
  const ciphertext = data.subarray(12, data.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), nonce);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plain.toString("utf8"));
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(`${field} 不能为空`);
  }
  return value.trim();
}

export function normalizeUserModelConfig(raw: {
  rerank?: Partial<RerankModelConfig> | null;
}): UserModelConfig {
  const rerank = raw.rerank;
  if (!rerank) throw new ValidationError("rerank 配置缺失");
  if (
    rerank.provider !== "siliconflow-compatible" &&
    rerank.provider !== "voyage" &&
    rerank.provider !== "custom"
  ) {
    throw new ValidationError("rerank.provider 仅支持 siliconflow-compatible / voyage / custom");
  }
  const baseUrl = requireString(rerank.baseUrl, "rerank.baseUrl");
  validateUserRerankProviderUrl(baseUrl, "rerank.baseUrl");
  return {
    rerank: {
      provider: rerank.provider,
      model: requireString(rerank.model, "rerank.model"),
      baseUrl,
      apiKey: typeof rerank.apiKey === "string" ? rerank.apiKey.trim() : "",
    },
  };
}

export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}
