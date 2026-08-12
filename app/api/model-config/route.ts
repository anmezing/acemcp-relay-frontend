import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { ValidationError } from "@/lib/errors";
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
    if (!row || !row.config_enc) return NextResponse.json({ ...base, configured: false });
    const config = decryptModelConfig(row.config_enc);
    return NextResponse.json({
      ...base,
      configured: true,
      rerank: { ...config.rerank, apiKey: maskSecret(config.rerank.apiKey) },
    });
  } catch (error) {
    console.error("model config read failed:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!modelConfigEnabled()) {
    return NextResponse.json(
      { error: "服务端未启用自定义 rerank（未配置 MODEL_CONFIG_SECRET）" },
      { status: 400 }
    );
  }

  let body: { reset?: boolean; rerank?: Record<string, unknown> | null } = {};
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
    if (!config.rerank.apiKey) {
      const row = await getUserModelConfigRow(user.id);
      const existing: UserModelConfig | null = row
        ? decryptModelConfig(row.config_enc)
        : null;
      const previous = existing?.rerank.provider === config.rerank.provider
        ? existing.rerank.apiKey
        : "";
      if (!previous) {
        return NextResponse.json({ error: "请填写 rerank API Key" }, { status: 400 });
      }
      config.rerank.apiKey = previous;
    }

    await saveUserModelConfig(user.id, config);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("model config save failed:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
