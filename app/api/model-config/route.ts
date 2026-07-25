import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  decryptModelConfig,
  maskSecret,
  modelConfigEnabled,
  normalizeUserModelConfig,
  type UserModelConfig,
} from "@/lib/model-config-crypto";
import {
  getUserModelConfigRow,
  resetUserModelConfig,
  saveUserModelConfig,
} from "@/lib/model-config-db";

async function requireUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user?.id ? session.user : null;
}

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const enabled = modelConfigEnabled();
  const base = {
    enabled,
    platformDefaults: {
      embeddings: {
        provider: process.env.EMBEDDINGS_PROVIDER || "",
        model: process.env.EMBEDDINGS_MODEL || "",
      },
      rerank: {
        provider: process.env.RERANK_PROVIDER || "",
        model: process.env.RERANK_MODEL || "",
      },
    },
  };
  if (!enabled) return NextResponse.json({ ...base, configured: false });

  try {
    const row = await getUserModelConfigRow(user.id);
    if (!row || !row.config_enc) {
      return NextResponse.json({ ...base, configured: false });
    }
    const config = decryptModelConfig(row.config_enc);
    return NextResponse.json({
      ...base,
      configured: true,
      pendingReindex: row.fingerprint !== (row.applied_fingerprint || ""),
      embeddings: {
        ...config.embeddings,
        apiKey: maskSecret(config.embeddings.apiKey),
      },
      rerank: config.rerank
        ? { ...config.rerank, apiKey: maskSecret(config.rerank.apiKey) }
        : null,
    });
  } catch (error) {
    console.error("model config read failed:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

// POST body:
//   { reset: true }                          恢复平台默认
//   { embeddings: {...}, rerank?: {...} }    保存自定义配置；apiKey 留空表示沿用已保存的值
export async function POST(request: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!modelConfigEnabled()) {
    return NextResponse.json(
      { error: "服务端未启用自定义模型（未配置 MODEL_CONFIG_SECRET）" },
      { status: 400 }
    );
  }

  let body: {
    reset?: boolean;
    embeddings?: Record<string, unknown>;
    rerank?: Record<string, unknown> | null;
  } = {};
  try {
    body = await request.json();
  } catch {}

  try {
    if (body.reset) {
      await resetUserModelConfig(user.id);
      return NextResponse.json({ ok: true, reset: true });
    }

    const config = normalizeUserModelConfig(
      body as Parameters<typeof normalizeUserModelConfig>[0]
    );

    // apiKey 留空 → 沿用已保存配置里的 key（避免每次编辑都要重填密钥）
    if (!config.embeddings.apiKey || (config.rerank && !config.rerank.apiKey)) {
      const row = await getUserModelConfigRow(user.id);
      const existing: UserModelConfig | null = row?.config_enc
        ? decryptModelConfig(row.config_enc)
        : null;
      if (!config.embeddings.apiKey) {
        const previous = existing?.embeddings.apiKey || "";
        if (!previous) {
          return NextResponse.json({ error: "请填写 embeddings API Key" }, { status: 400 });
        }
        config.embeddings.apiKey = previous;
      }
      if (config.rerank && !config.rerank.apiKey) {
        const previous = existing?.rerank?.apiKey || "";
        if (!previous) {
          return NextResponse.json({ error: "请填写 rerank API Key" }, { status: 400 });
        }
        config.rerank.apiKey = previous;
      }
    }

    await saveUserModelConfig(user.id, config);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "internal error";
    const isValidation = /必须|不能为空|仅支持|缺失|API Key/.test(message);
    if (!isValidation) console.error("model config save failed:", error);
    return NextResponse.json({ error: message }, { status: isValidation ? 400 : 500 });
  }
}
