import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { decryptModelConfig } from "@/lib/model-config-crypto";
import { getUserModelConfigRow } from "@/lib/model-config-db";
import { SILICONFLOW_RERANK_MODELS_URL } from "@/lib/model-provider-presets";
import { parseSiliconFlowRerankModels } from "@/lib/rerank-model-discovery";
import {
  modelDiscoveryProxyTimeoutMs,
  providerModelDiscoveryResponseLimitBytes,
} from "@/lib/server-runtime-config";


async function savedSiliconFlowKey(userId: string): Promise<string> {
  const row = await getUserModelConfigRow(userId);
  if (!row?.config_enc) return "";
  const config = decryptModelConfig(row.config_enc);
  return config.rerank.provider === "siliconflow-compatible"
    ? config.rerank.apiKey
    : "";
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as
    | { provider?: unknown; apiKey?: unknown }
    | null;
  if (body?.provider !== "siliconflow-compatible") {
    return NextResponse.json({ error: "该供应商不支持动态获取模型" }, { status: 400 });
  }

  const submittedKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const apiKey = submittedKey || await savedSiliconFlowKey(session.user.id);
  if (!apiKey) {
    return NextResponse.json({ error: "请先填写 SiliconFlow API Key" }, { status: 400 });
  }

  try {
    const response = await fetch(SILICONFLOW_RERANK_MODELS_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(modelDiscoveryProxyTimeoutMs()),
    });
    if (!response.ok) {
      const message = response.status === 401 || response.status === 403
        ? "API Key 无效或无权访问模型列表"
        : `供应商返回 HTTP ${response.status}`;
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > providerModelDiscoveryResponseLimitBytes()) {
      return NextResponse.json({ error: "模型列表响应过大" }, { status: 502 });
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > providerModelDiscoveryResponseLimitBytes()) {
      return NextResponse.json({ error: "模型列表响应过大" }, { status: 502 });
    }
    const models = parseSiliconFlowRerankModels(JSON.parse(text));
    if (models.length === 0) {
      return NextResponse.json({ error: "供应商未返回可用的 Rerank 模型" }, { status: 502 });
    }
    return NextResponse.json({ models });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "供应商返回了无效响应" }, { status: 502 });
    }
    return NextResponse.json({ error: "获取模型失败，请稍后重试" }, { status: 502 });
  }
}
