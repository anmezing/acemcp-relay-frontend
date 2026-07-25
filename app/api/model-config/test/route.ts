import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  decryptModelConfig,
  modelConfigEnabled,
  normalizeUserModelConfig,
} from "@/lib/model-config-crypto";
import { getUserModelConfigRow } from "@/lib/model-config-db";

// 连通性测试：用用户提交的 embeddings 配置真实调一次 embedding API，
// 返回实际向量维度（与配置维度不一致时前端提示）。apiKey 留空沿用已保存值。
export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!modelConfigEnabled()) {
    return NextResponse.json({ error: "服务端未启用自定义模型" }, { status: 400 });
  }

  let body: { embeddings?: Record<string, unknown> } = {};
  try {
    body = await request.json();
  } catch {}

  try {
    const config = normalizeUserModelConfig({ embeddings: body.embeddings });
    if (!config.embeddings.apiKey) {
      const row = await getUserModelConfigRow(session.user.id);
      const previous = row?.config_enc
        ? decryptModelConfig(row.config_enc).embeddings.apiKey
        : "";
      if (!previous) {
        return NextResponse.json({ ok: false, error: "请填写 API Key" });
      }
      config.embeddings.apiKey = previous;
    }

    const e = config.embeddings;
    const payload: Record<string, unknown> = { model: e.model, input: ["connectivity test"] };
    if (e.provider === "voyage") payload.input_type = "query";

    const resp = await fetch(e.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${e.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    const text = await resp.text();
    if (!resp.ok) {
      return NextResponse.json({
        ok: false,
        error: `HTTP ${resp.status}: ${text.slice(0, 300)}`,
      });
    }
    let json: { data?: { embedding?: unknown }[] } | null = null;
    try {
      json = JSON.parse(text);
    } catch {}
    const embedding = json?.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) {
      return NextResponse.json({ ok: false, error: "响应不含 embedding 数组，请确认 baseUrl 指向 embeddings 端点" });
    }
    return NextResponse.json({
      ok: true,
      dimensions: embedding.length,
      dimensionsMatch: embedding.length === e.dimensions,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message.slice(0, 300) });
  }
}
