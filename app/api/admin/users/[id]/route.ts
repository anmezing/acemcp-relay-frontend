import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin";
import { getUserAdminDetail } from "@/lib/admin-db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const { id } = await params;
    return NextResponse.json(await getUserAdminDetail(id));
  } catch (error) {
    console.error("admin user detail failed:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
