import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getApiKey, initDB } from "@/lib/db";
import { ensureOrgApiKey, getMemberRole } from "@/lib/org-db";
import { getRelayConsoleHeaders } from "@/lib/relay-console";

const RELAY_URL = process.env.LCE_RELAY_URL || "http://relay:3009";

// 清理失败任务记录不会删除已发布索引，但仍属于组织索引管理操作，因此组织
// 上下文只允许 owner。Relay 会再次做权威权限校验。
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
          { error: "仅组织所有者可清理组织索引失败记录" },
          { status: 403 },
        );
      }
      apiKey = (await ensureOrgApiKey(session.user.id, orgId, role)).api_key;
    } else {
      const keyRecord = await getApiKey(session.user.id);
      if (!keyRecord) {
        return NextResponse.json({ error: "请先生成 API Key" }, { status: 400 });
      }
      apiKey = keyRecord.api_key;
    }

    const res = await fetch(`${RELAY_URL}/mcp/dismiss-root-failure`, {
      method: "POST",
      headers: {
        ...getRelayConsoleHeaders(apiKey),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ root_id: rootId }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        { error: data.error || "清理失败记录失败" },
        { status: res.status },
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("清理索引失败记录失败:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
