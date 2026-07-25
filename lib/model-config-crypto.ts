import crypto from "crypto";

// 按用户模型配置的加密与指纹。
// 加密：AES-256-GCM，密钥 = SHA-256(MODEL_CONFIG_SECRET)，
// 密文布局 base64(nonce[12] || ciphertext || tag[16])——必须与
// acemcp-relay/modelconfig.go 的 decryptModelConfig 保持一致。

export interface EmbeddingsModelConfig {
  provider: "openai-compatible" | "voyage";
  model: string;
  baseUrl: string;
  apiKey: string;
  dimensions: number;
  queryPrefix?: string;
  documentPrefix?: string;
}

export interface RerankModelConfig {
  provider: "siliconflow-compatible" | "voyage" | "custom";
  model: string;
  baseUrl: string;
  apiKey: string;
}

export interface UserModelConfig {
  embeddings: EmbeddingsModelConfig;
  rerank?: RerankModelConfig;
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

// 恢复平台默认时写入的指纹哨兵值（relay 只比较 fingerprint 与
// applied_fingerprint 是否相等，具体格式由前端定义）
export const DEFAULT_FINGERPRINT = "default";

// 指纹只含模型身份字段，不含 apiKey——仅轮换 key 不应触发索引重建
export function modelConfigFingerprint(config: UserModelConfig): string {
  const identity = {
    e: {
      provider: config.embeddings.provider,
      model: config.embeddings.model,
      baseUrl: config.embeddings.baseUrl,
      dimensions: config.embeddings.dimensions,
      documentPrefix: config.embeddings.documentPrefix ?? null,
    },
    r: config.rerank
      ? {
          provider: config.rerank.provider,
          model: config.rerank.model,
          baseUrl: config.rerank.baseUrl,
        }
      : null,
  };
  return (
    "mc1:" +
    crypto.createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 40)
  );
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} 不能为空`);
  }
  return value.trim();
}

// 校验并归一化用户提交的配置（apiKey 允许为空串，由调用方决定沿用旧值）
export function normalizeUserModelConfig(raw: {
  embeddings?: Partial<EmbeddingsModelConfig>;
  rerank?: Partial<RerankModelConfig> | null;
}): UserModelConfig {
  const e = raw.embeddings;
  if (!e) throw new Error("embeddings 配置缺失");
  if (e.provider !== "openai-compatible" && e.provider !== "voyage") {
    throw new Error("embeddings.provider 仅支持 openai-compatible / voyage");
  }
  const dimensions = Number(e.dimensions);
  if (!Number.isInteger(dimensions) || dimensions <= 0 || dimensions > 65536) {
    throw new Error("embeddings.dimensions 必须是正整数");
  }
  const baseUrl = requireString(e.baseUrl, "embeddings.baseUrl");
  // 仅允许 https：该 URL 会被 LCE / 前端在服务端调用，禁 http 阻断内网探测（SSRF）
  if (!/^https:\/\//i.test(baseUrl)) {
    throw new Error("embeddings.baseUrl 必须以 https:// 开头");
  }
  const config: UserModelConfig = {
    embeddings: {
      provider: e.provider,
      model: requireString(e.model, "embeddings.model"),
      baseUrl,
      apiKey: typeof e.apiKey === "string" ? e.apiKey.trim() : "",
      dimensions,
      queryPrefix: e.queryPrefix || undefined,
      documentPrefix: e.documentPrefix || undefined,
    },
  };
  if (raw.rerank) {
    const r = raw.rerank;
    if (r.provider !== "siliconflow-compatible" && r.provider !== "voyage" && r.provider !== "custom") {
      throw new Error("rerank.provider 仅支持 siliconflow-compatible / voyage / custom");
    }
    const rerankBaseUrl = requireString(r.baseUrl, "rerank.baseUrl");
    if (!/^https:\/\//i.test(rerankBaseUrl)) {
      throw new Error("rerank.baseUrl 必须以 https:// 开头");
    }
    config.rerank = {
      provider: r.provider,
      model: requireString(r.model, "rerank.model"),
      baseUrl: rerankBaseUrl,
      apiKey: typeof r.apiKey === "string" ? r.apiKey.trim() : "",
    };
  }
  return config;
}

export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}
