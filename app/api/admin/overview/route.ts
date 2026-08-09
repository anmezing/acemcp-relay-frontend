import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin";
import { getAdminOverview } from "@/lib/admin-db";

export async function GET() {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const overview = await getAdminOverview();
    return NextResponse.json({ overview });
  } catch (error) {
    console.error("admin overview failed:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
