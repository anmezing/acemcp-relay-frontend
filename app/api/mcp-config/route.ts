import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { initDB, createApiKey } from "@/lib/db";
import { ensureOrgApiKey, getMemberRole } from "@/lib/org-db";

// Return the selected personal or organization API key for one-click MCP config generation.
// Existing keys are reused and never rotated by this endpoint.
export async function POST(request: Request) {
  try {
    await initDB().catch(console.error);
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body: unknown = await request.json().catch(() => null);
    const orgId =
      body && typeof body === "object" && "orgId" in body && typeof body.orgId === "string"
        ? body.orgId.trim()
        : "";

    if (orgId) {
      const role = await getMemberRole(session.user.id, orgId);
      if (!role) {
        return NextResponse.json({ error: "不是该组织成员" }, { status: 403 });
      }
      const keyRecord = await ensureOrgApiKey(session.user.id, orgId, role);
      return NextResponse.json({ apiKey: keyRecord.api_key });
    }

    const keyRecord = await createApiKey(session.user.id);
    return NextResponse.json({ apiKey: keyRecord.api_key });
  } catch (error) {
    console.error("获取 MCP 配置失败:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
