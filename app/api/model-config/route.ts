import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { ValidationError } from "@/lib/errors";
import {
  decryptModelConfig,
  modelConfigEnabled,
  normalizeUserModelConfig,
  type UserModelConfig,
} from "@/lib/model-config-crypto";
import {
  getUserModelConfigRow,
  resetUserModelConfig,
  saveUserModelConfig,
} from "@/lib/model-config-db";
import { fetchPlatformModelConfig } from "@/lib/platform-model-config";

async function requireUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user?.id ? session.user : null;
}

async function resetToPlatform(userId: string) {
  await resetUserModelConfig(userId);
  return NextResponse.json({
    ok: true,
    reset: true,
    configured: false,
    effectiveSource: "platform" as const,
    apiKeyConfigured: false,
  });
}

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let platform;
  try {
    platform = await fetchPlatformModelConfig();
  } catch (error) {
    console.error("platform model config read failed:", error);
    return NextResponse.json({ error: "模型配置服务不可用" }, { status: 502 });
  }

  const enabled = modelConfigEnabled();
  const base = {
    enabled,
    platformDefaults: {
      embeddings: {
        provider: platform.embeddings.provider,
        model: platform.embeddings.model,
        baseUrl: platform.embeddings.baseUrl,
      },
      rerank: {
        provider: platform.rerank.provider,
        model: platform.rerank.model,
        baseUrl: platform.rerank.baseUrl,
      },
    },
  };
  if (!enabled) {
    return NextResponse.json({
      ...base,
      configured: false,
      effectiveSource: "platform",
      apiKeyConfigured: false,
    });
  }

  try {
    const row = await getUserModelConfigRow(user.id);
    if (!row?.config_enc) {
      return NextResponse.json({
        ...base,
        configured: false,
        effectiveSource: "platform",
        apiKeyConfigured: false,
      });
    }
    const config = decryptModelConfig(row.config_enc);
    return NextResponse.json({
      ...base,
      configured: true,
      effectiveSource: "personal",
      apiKeyConfigured: Boolean(config.rerank.apiKey),
      // API keys are write-only. Do not return even a masked derivative because it
      // creates ambiguous "is this the key?" form behavior and leaks key shape.
      rerank: {
        provider: config.rerank.provider,
        model: config.rerank.model,
        baseUrl: config.rerank.baseUrl,
      },
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

  let body: {
    mode?: "personal" | "platform";
    reset?: boolean;
    rerank?: Record<string, unknown> | null;
  } = {};
  try {
    body = await request.json();
  } catch {}

  try {
    // `reset` is kept for compatibility with older deployed frontends.
    if (body.reset || body.mode === "platform") return resetToPlatform(user.id);

    const config = normalizeUserModelConfig(
      body as Parameters<typeof normalizeUserModelConfig>[0]
    );
    if (!config.rerank.apiKey) {
      const row = await getUserModelConfigRow(user.id);
      const existing: UserModelConfig | null = row?.config_enc
        ? decryptModelConfig(row.config_enc)
        : null;
      // A saved secret may only be reused for the exact same credential target.
      // Provider equality alone is insufficient for custom OpenAI-compatible hosts.
      const previous =
        existing?.rerank.provider === config.rerank.provider &&
        existing.rerank.baseUrl === config.rerank.baseUrl
          ? existing.rerank.apiKey
          : "";
      if (!previous) {
        return NextResponse.json({ error: "请填写 rerank API Key" }, { status: 400 });
      }
      config.rerank.apiKey = previous;
    }

    await saveUserModelConfig(user.id, config);
    return NextResponse.json({
      ok: true,
      configured: true,
      effectiveSource: "personal",
      apiKeyConfigured: true,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("model config save failed:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

export async function DELETE() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!modelConfigEnabled()) {
    return NextResponse.json(
      { error: "服务端未启用自定义 rerank（未配置 MODEL_CONFIG_SECRET）" },
      { status: 400 }
    );
  }
  try {
    return await resetToPlatform(user.id);
  } catch (error) {
    console.error("model config reset failed:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
