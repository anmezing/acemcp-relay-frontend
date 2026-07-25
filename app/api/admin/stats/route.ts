import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin";
import { getCallStats } from "@/lib/admin-db";

export async function GET() {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    return NextResponse.json(await getCallStats());
  } catch (error) {
    console.error("admin stats failed:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
