import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin";
import { listUsersWithStats } from "@/lib/admin-db";

export async function GET() {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    return NextResponse.json({ users: await listUsersWithStats() });
  } catch (error) {
    console.error("admin users list failed:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
