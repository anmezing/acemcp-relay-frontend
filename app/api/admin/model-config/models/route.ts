import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin";
import { getRelayAdminHeaders } from "@/lib/relay-console";

const RELAY_URL = process.env.LCE_RELAY_URL || "http://relay:3009";
const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: Request) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "请求体过大" }, { status: 413 });
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  try {
    const response = await fetch(`${RELAY_URL}/internal/platform-model-config`, {
      method: "POST",
      headers: { ...getRelayAdminHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "models",
        kind: body.kind === "embeddings" || body.kind === "rerank" || body.kind === "promptEnhancer" ? body.kind : "",
        provider: typeof body.provider === "string" ? body.provider : "",
        baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : "",
        apiKey: typeof body.apiKey === "string" ? body.apiKey : "",
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const responseText = await response.text();
    if (Buffer.byteLength(responseText, "utf8") > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "模型列表响应过大" }, { status: 502 });
    }
    let data: unknown;
    try {
      data = JSON.parse(responseText);
    } catch {
      return NextResponse.json({ error: "模型配置服务返回了无效响应" }, { status: 502 });
    }
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ error: "模型配置服务不可用" }, { status: 502 });
  }
}
