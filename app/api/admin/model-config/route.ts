import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin";
import { getRelayAdminHeaders } from "@/lib/relay-console";
import { fetchPlatformModelConfig } from "@/lib/platform-model-config";
import { JsonBodyTooLargeError, readBoundedJson } from "@/lib/bounded-json";
import { validateModelConfigRequest } from "@/lib/model-config-validation";
import {
  MODEL_CONFIG_SAVE_PROXY_TIMEOUT_MS,
  ModelConfigRequestTimeoutError,
  withModelConfigDeadline,
} from "@/lib/model-config-request";

const RELAY_URL = process.env.LCE_RELAY_URL || "http://relay:3009";
const CONFIG_URL = `${RELAY_URL}/internal/platform-model-config`;
const MAX_BODY_BYTES = 64 * 1024;

async function relayResponse(response: Response, signal: AbortSignal): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await readBoundedJson(response, MAX_BODY_BYTES, signal);
  } catch {
    return NextResponse.json({ error: "模型配置服务返回了无效响应" }, { status: 502 });
  }
  return NextResponse.json(body, { status: response.status });
}

export async function GET(request: Request) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const operation = new URL(request.url).searchParams.get("operation");
    if (operation) {
      if (operation !== "latest" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operation))
        return NextResponse.json({ error: "Invalid configuration operation identity" }, { status: 400 });
      return await withModelConfigDeadline(async (signal) => {
        const response = await fetch(`${CONFIG_URL}?operation=${encodeURIComponent(operation)}`, {
          headers: getRelayAdminHeaders(), signal, cache: "no-store",
        });
        return relayResponse(response, signal);
      }, 15_000, request.signal);
    }
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
  let body: unknown;
  try {
    body = await readBoundedJson(request, MAX_BODY_BYTES);
    validateModelConfigRequest(body);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "请求体必须是 JSON" },
      { status: error instanceof JsonBodyTooLargeError ? 413 : 400 });
  }
  try {
    return await withModelConfigDeadline(async (signal) => {
      const response = await fetch(CONFIG_URL, {
        method: "POST",
        headers: { ...getRelayAdminHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      return await relayResponse(response, signal);
    }, MODEL_CONFIG_SAVE_PROXY_TIMEOUT_MS, request.signal);
  } catch (error) {
    if (error instanceof ModelConfigRequestTimeoutError || request.signal.aborted) {
      return NextResponse.json({
        error: "模型配置请求已超时或取消，保存结果尚未确认，请刷新配置核对后再重试",
      }, { status: 504 });
    }
    console.error("admin model config save failed:", error);
    return NextResponse.json({ error: "模型配置服务不可用" }, { status: 502 });
  }
}
