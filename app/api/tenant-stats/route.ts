import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getApiKey, initDB } from "@/lib/db";
import { ensureOrgApiKey, getMemberRole } from "@/lib/org-db";
import { getRelayConsoleHeaders } from "@/lib/relay-console";

const RELAY_URL = process.env.LCE_RELAY_URL || "http://relay:3009";

export async function GET(request: NextRequest) {
  try {
    await initDB();
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const orgId = request.nextUrl.searchParams.get("orgId")?.trim() || null;
    let apiKey: string;
    if (orgId) {
      const role = await getMemberRole(session.user.id, orgId);
      if (!role) {
        return NextResponse.json({ error: "不是该组织成员" }, { status: 403 });
      }
      apiKey = (await ensureOrgApiKey(session.user.id, orgId, role)).api_key;
    } else {
      const keyRecord = await getApiKey(session.user.id);
      if (!keyRecord) {
        return NextResponse.json(
          { exists: false, fileCount: 0, chunkCount: 0, vectorIndexedCount: 0, totalSizeBytes: 0, languages: {} }
        );
      }
      apiKey = keyRecord.api_key;
    }

    const res = await fetch(`${RELAY_URL}/mcp/tenant-stats`, {
      headers: getRelayConsoleHeaders(apiKey),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: data.error || "获取统计失败" },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("获取租户统计失败:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
