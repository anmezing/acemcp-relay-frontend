import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getApiKey, initDB } from "@/lib/db";
import { ensureOrgApiKey, getMemberRole } from "@/lib/org-db";
import { getRelayConsoleHeaders } from "@/lib/relay-console";
import { isRelayConnectionError, RELAY_UNAVAILABLE_RESPONSE } from "@/lib/relay-network-error";

const RELAY_URL = process.env.LCE_RELAY_URL || "http://relay:3009";
const DELETE_ROOT_TIMEOUT_MS = 10_000;

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
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(
      res.ok ? data : { error: data.error || "获取删除任务失败" },
      { status: res.status, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("获取删除任务失败:", error);
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
      body: JSON.stringify({ root_id: rootId }),
      signal: AbortSignal.timeout(DELETE_ROOT_TIMEOUT_MS),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        { error: data.error || "删除失败" },
        { status: res.status }
      );
    }

    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("删除索引失败:", error);
    if (isRelayConnectionError(error)) {
      return NextResponse.json(RELAY_UNAVAILABLE_RESPONSE, { status: 503 });
    }
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
