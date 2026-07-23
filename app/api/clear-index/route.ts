import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getApiKey } from "@/lib/db";

const RELAY_URL = process.env.LCE_RELAY_URL || "http://relay:3009";

export async function POST() {
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
        { error: "请先生成 API Key" },
        { status: 400 }
      );
    }

    const res = await fetch(`${RELAY_URL}/mcp/clear-index`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${keyRecord.api_key}`,
        "Content-Type": "application/json",
      },
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: data.error || "清除失败" },
        { status: res.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("清除索引失败:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
