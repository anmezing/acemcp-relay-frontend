import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin";
import { getRelayAdminHeaders } from "@/lib/relay-console";
import { fetchPlatformModelConfig } from "@/lib/platform-model-config";

const RELAY_URL = process.env.LCE_RELAY_URL || "http://relay:3009";
const CONFIG_URL = `${RELAY_URL}/internal/platform-model-config`;
const MAX_BODY_BYTES = 64 * 1024;

async function relayResponse(response: Response): Promise<NextResponse> {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "模型配置响应过大" }, { status: 502 });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "模型配置服务返回了无效响应" }, { status: 502 });
  }
  return NextResponse.json(body, { status: response.status });
}

export async function GET() {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    return NextResponse.json({ config: await fetchPlatformModelConfig() });
  } catch (error) {
    console.error("admin model config read failed:", error);
    return NextResponse.json({ error: "模型配置服务不可用" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "请求体过大" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  try {
    const response = await fetch(CONFIG_URL, {
      method: "POST",
      headers: { ...getRelayAdminHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(360_000),
    });
    return relayResponse(response);
  } catch (error) {
    console.error("admin model config save failed:", error);
    return NextResponse.json({ error: "模型配置服务不可用" }, { status: 502 });
  }
}
