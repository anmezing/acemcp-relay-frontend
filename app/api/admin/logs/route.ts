import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin";
import { listGlobalLogs } from "@/lib/admin-db";

const PAGE_SIZE = 50;

export async function GET(request: NextRequest) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const page = Math.max(1, parseInt(request.nextUrl.searchParams.get("page") || "1"));
    const errorsOnly = request.nextUrl.searchParams.get("errors") === "1";
    const logs = await listGlobalLogs(PAGE_SIZE, (page - 1) * PAGE_SIZE, errorsOnly);
    return NextResponse.json({ logs, page, pageSize: PAGE_SIZE });
  } catch (error) {
    console.error("admin logs failed:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
