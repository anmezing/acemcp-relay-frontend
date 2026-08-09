import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin";
import { adminResetUserKey, setUserBanned } from "@/lib/admin-db";

// 管理动作统一入口：
//   { action: "reset-key" }                      重置该用户 API key（旧 token 立即失效）
//   { action: "ban", reason? } / { action: "unban" }  封禁/解封（relay 请求层拦截）
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  let body: { action?: string; reason?: string } = {};
  try {
    body = await request.json();
  } catch {}

  try {
    switch (body.action) {
      case "reset-key":
        await adminResetUserKey(id);
        return NextResponse.json({ ok: true });
      case "ban":
        if (id === session.user.id) {
          return NextResponse.json({ error: "cannot ban yourself" }, { status: 400 });
        }
        await setUserBanned(id, true, body.reason);
        return NextResponse.json({ ok: true });
      case "unban":
        await setUserBanned(id, false);
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error(`admin action ${body.action} failed:`, error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
