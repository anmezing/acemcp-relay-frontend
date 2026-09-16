import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getApiKey, initDB } from "@/lib/db";
import { ensureOrgApiKey, getMemberRole } from "@/lib/org-db";
import { getRelayConsoleHeaders } from "@/lib/relay-console";
import { isRelayConnectionError, RELAY_UNAVAILABLE_RESPONSE } from "@/lib/relay-network-error";
import { JsonBodyTooLargeError, readBoundedJson } from "@/lib/bounded-json";

const RELAY_URL = process.env.LCE_RELAY_URL || "http://relay:3009";
const DELETE_ROOT_TIMEOUT_MS = 10_000;

async function deletionResponse(response: Response, maxBytes: number): Promise<Record<string, unknown>> {
  const value = await readBoundedJson(response, maxBytes);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyntaxError("Invalid deletion response");
  return value as Record<string, unknown>;
}

export async function GET(request: NextRequest) {
  try {
    await initDB();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const orgId = request.nextUrl.searchParams.get("orgId")?.trim();
    let apiKey: string;
    if (orgId) {
      const role = await getMemberRole(session.user.id, orgId);
      if (!role) {
        return NextResponse.json({ error: "不是该组织成员" }, { status: 403 });
      }
      apiKey = (await ensureOrgApiKey(session.user.id, orgId, role)).api_key;
    } else {
      const keyRecord = await getApiKey(session.user.id);
      if (!keyRecord) return NextResponse.json({ deletions: [] });
      apiKey = keyRecord.api_key;
    }

    const res = await fetch(`${RELAY_URL}/mcp/root-deletions`, {
      headers: getRelayConsoleHeaders(apiKey),
      signal: AbortSignal.timeout(DELETE_ROOT_TIMEOUT_MS),
      cache: "no-store",
    });
    const data = await deletionResponse(res, 256 * 1024);
    return NextResponse.json(
      res.ok ? data : { error: data.error || "获取删除任务失败" },
      { status: res.status, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("获取删除任务失败:", error);
    if (error instanceof JsonBodyTooLargeError || error instanceof SyntaxError)
      return NextResponse.json({ error: "删除服务返回了无效响应" }, { status: 502 });
    if (isRelayConnectionError(error)) {
      return NextResponse.json(RELAY_UNAVAILABLE_RESPONSE, { status: 503 });
    }
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

// 谁能调：登录用户删自己个人租户的索引；body.org_id 时仅该组织 owner
// （成员 403，前端先挡；Relay 再按 Better Auth member.role 权威校验）。
export async function POST(request: Request) {
  try {
    await initDB();
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body: unknown = await request.json().catch(() => null);
    const rootId =
      body && typeof body === "object" && "root_id" in body && typeof body.root_id === "string"
        ? body.root_id.trim()
        : "";
    if (!rootId) {
      return NextResponse.json({ error: "缺少 root_id" }, { status: 400 });
    }
    const orgId =
      body && typeof body === "object" && "org_id" in body && typeof body.org_id === "string"
        ? body.org_id.trim()
        : "";

    const retryJobId = body && typeof body === "object" && "retry_job_id" in body ? body.retry_job_id : undefined;
    if (retryJobId !== undefined && (typeof retryJobId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(retryJobId))) {
      return NextResponse.json({ error: "无效的 retry_job_id" }, { status: 400 });
    }

    let apiKey: string;
    if (orgId) {
      const role = await getMemberRole(session.user.id, orgId);
      if (role !== "owner") {
        return NextResponse.json(
          { error: "仅组织所有者可删除组织索引" },
          { status: 403 }
        );
      }
      apiKey = (await ensureOrgApiKey(session.user.id, orgId, role)).api_key;
    } else {
      const keyRecord = await getApiKey(session.user.id);
      if (!keyRecord) {
        return NextResponse.json(
          { error: "请先生成 API Key" },
          { status: 400 }
        );
      }
      apiKey = keyRecord.api_key;
    }

    const res = await fetch(`${RELAY_URL}/mcp/root-deletions`, {
      method: "POST",
      headers: {
        ...getRelayConsoleHeaders(apiKey),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ root_id: rootId, ...(retryJobId !== undefined ? { retry_job_id: retryJobId } : {}) }),
      signal: AbortSignal.timeout(DELETE_ROOT_TIMEOUT_MS),
    });

    const data = await deletionResponse(res, 16 * 1024);

    if (!res.ok) {
      return NextResponse.json(
        { error: data.error || "删除失败" },
        { status: res.status }
      );
    }

    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("删除索引失败:", error);
    if (error instanceof JsonBodyTooLargeError || error instanceof SyntaxError)
      return NextResponse.json({ error: "删除服务返回了无效响应" }, { status: 502 });
    if (isRelayConnectionError(error)) {
      return NextResponse.json(RELAY_UNAVAILABLE_RESPONSE, { status: 503 });
    }
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
