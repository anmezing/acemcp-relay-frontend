import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  getClientVersionSummary,
  LCE_CLOUD_UPGRADE_COMMAND,
} from "@/lib/client-version-policy";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const summary = await getClientVersionSummary();
  return NextResponse.json({
    ...summary,
    upgradeCommand: LCE_CLOUD_UPGRADE_COMMAND,
  });
}
