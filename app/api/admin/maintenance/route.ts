import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin";
import { clearRequestLogs } from "@/lib/admin-db";

// 危险操作统一入口：
//   { action: "clear-logs" }                    清空全部请求日志（含错误详情）
//   { action: "clear-logs", olderThanDays: 30 } 清理 30 天前的请求日志
export async function POST(request: NextRequest) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let body: { action?: string; olderThanDays?: number } = {};
  try {
    body = await request.json();
  } catch {}

  try {
    switch (body.action) {
      case "clear-logs": {
        const days =
          body.olderThanDays && body.olderThanDays > 0
            ? Math.floor(body.olderThanDays)
            : undefined;
        const deleted = await clearRequestLogs(days);
        console.log(`admin cleared ${deleted} request logs (olderThanDays=${days ?? "all"})`);
        return NextResponse.json({ ok: true, deleted });
      }
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error(`admin maintenance ${body.action} failed:`, error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
