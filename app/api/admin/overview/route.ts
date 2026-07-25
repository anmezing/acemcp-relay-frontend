import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin";
import { getAdminOverview, listRecentAlerts } from "@/lib/admin-db";

export async function GET() {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const [overview, alerts] = await Promise.all([
      getAdminOverview(),
      listRecentAlerts(30),
    ]);
    return NextResponse.json({ overview, alerts });
  } catch (error) {
    console.error("admin overview failed:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
