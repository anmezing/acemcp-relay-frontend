import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getApiKey, initDB } from "@/lib/db";
import { ensureOrgApiKey, getMemberRole } from "@/lib/org-db";
import { getRelayConsoleHeaders } from "@/lib/relay-console";
import { relayUrl } from "@/lib/server-runtime-config";


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
    const orgId =
      body && typeof body === "object" && "org_id" in body && typeof body.org_id === "string"
        ? body.org_id.trim()
        : "";
    let apiKey: string;
    if (orgId) {
      const role = await getMemberRole(session.user.id, orgId);
      if (role !== "owner") {
        return NextResponse.json({ error: "仅组织所有者可清除组织索引" }, { status: 403 });
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

    const res = await fetch(relayUrl("/mcp/clear-index"), {
      method: "POST",
      headers: {
        ...getRelayConsoleHeaders(apiKey),
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
