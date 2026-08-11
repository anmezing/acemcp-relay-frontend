import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin";
import { adminResetUserKey, adminSetTier, setUserBanned } from "@/lib/admin-db";

// 管理动作统一入口：
//   { action: "reset-key" }                      重置该用户 API key（旧 token 立即失效）
//   { action: "ban", reason? } / { action: "unban" }  封禁/解封（relay 请求层拦截）
//   { action: "set-tier", tier: "free"|"pro" }   设置分层（relay 认证缓存 30s 内生效）
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  let body: { action?: string; reason?: string; tier?: string } = {};
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
      case "set-tier": {
        // fail-closed：只放行显式合法值
        if (body.tier !== "free" && body.tier !== "pro") {
          return NextResponse.json({ error: "invalid tier" }, { status: 400 });
        }
        const updated = await adminSetTier(id, body.tier);
        if (!updated) {
          return NextResponse.json(
            { error: "user has no api key" },
            { status: 400 }
          );
        }
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error(`admin action ${body.action} failed:`, error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
