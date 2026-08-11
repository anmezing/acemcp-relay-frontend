import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { initDB, maskApiKey } from "@/lib/db";
import { listUserApiKeys } from "@/lib/org-db";

// 密钥管理页列表：个人密钥 + 各组织密钥。谁能调：登录用户（只看自己的）。
export async function GET() {
  try {
    await initDB().catch(console.error);
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const rows = await listUserApiKeys(session.user.id);
    return NextResponse.json({
      keys: rows.map((row) => ({
        orgId: row.org_id,
        orgName: row.org_name,
        orgRole: row.org_role,
        maskedKey: maskApiKey(row.api_key),
        tier: row.tier === "pro" ? "pro" : "free",
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    console.error("获取密钥列表失败:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
