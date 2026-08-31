import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin";
import { getRelayAdminHeaders } from "@/lib/relay-console";
import { fetchPlatformModelConfig } from "@/lib/platform-model-config";
import {
  modelConfigSaveProxyTimeoutMs,
  platformModelConfigBodyLimitBytes,
  relayUrl,
} from "@/lib/server-runtime-config";


function combineSignals(...signals: AbortSignal[]): AbortSignal {
  const anySignal = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof anySignal === "function") return anySignal(signals);
  const controller = new AbortController();
  const abort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };
  for (const signal of signals) {
    if (signal.aborted) {
      abort(signal);
      break;
    }
    signal.addEventListener("abort", () => abort(signal), { once: true });
  }
  return controller.signal;
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (
    error.name === "TimeoutError" ||
    /timed? out|timeout/i.test(error.message)
  );
}

async function relayResponse(response: Response): Promise<NextResponse> {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > platformModelConfigBodyLimitBytes()) {
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
  if (Buffer.byteLength(text, "utf8") > platformModelConfigBodyLimitBytes()) {
    return NextResponse.json({ error: "请求体过大" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  try {
    const response = await fetch(relayUrl("/internal/platform-model-config"), {
      method: "POST",
      headers: { ...getRelayAdminHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: combineSignals(request.signal, AbortSignal.timeout(modelConfigSaveProxyTimeoutMs())),
    });
    return relayResponse(response);
  } catch (error) {
    console.error("admin model config save failed:", error);
    if (request.signal.aborted) {
      return NextResponse.json({ error: "请求已取消", code: "REQUEST_ABORTED" }, { status: 499 });
    }
    if (isTimeoutError(error)) {
      return NextResponse.json({
        error: "保存模型配置超时；请检查供应商网络、余额和服务状态后重试",
        code: "MODEL_CONFIG_PROXY_TIMEOUT",
      }, { status: 504 });
    }
    return NextResponse.json({ error: "模型配置服务不可用" }, { status: 502 });
  }
}
