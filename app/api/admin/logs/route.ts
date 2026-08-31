import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin";
import { listGlobalLogs } from "@/lib/admin-db";
import { adminLogPageSize } from "@/lib/server-runtime-config";

export async function GET(request: NextRequest) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    // parseInt 对非数字返回 NaN，Math.max(1, NaN) 仍是 NaN，会进 SQL OFFSET 炸 500
    const page = Math.max(1, parseInt(request.nextUrl.searchParams.get("page") || "1") || 1);
    const errorsOnly = request.nextUrl.searchParams.get("errors") === "1";
    const pageSize = adminLogPageSize();
    const logs = await listGlobalLogs(pageSize, (page - 1) * pageSize, errorsOnly);
    return NextResponse.json({ logs, page, pageSize });
  } catch (error) {
    console.error("admin logs failed:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
