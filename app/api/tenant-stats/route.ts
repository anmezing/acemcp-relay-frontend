import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getApiKey } from "@/lib/db";

const RELAY_URL = process.env.LCE_RELAY_URL || "http://relay:3009";

export async function GET() {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const keyRecord = await getApiKey(session.user.id);
    if (!keyRecord) {
      return NextResponse.json(
        { exists: false, fileCount: 0, chunkCount: 0, vectorIndexedCount: 0, totalSizeBytes: 0, languages: {} }
      );
    }

    const res = await fetch(`${RELAY_URL}/mcp/tenant-stats`, {
      headers: {
        Authorization: `Bearer ${keyRecord.api_key}`,
      },
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
