import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin";
import { saveRelayMinimumClientVersion } from "@/lib/client-version-policy";

export async function POST(request: NextRequest) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let body: { minimumVersion?: unknown } = {};
  try {
    const parsed: unknown = await request.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as { minimumVersion?: unknown };
    }
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!Object.prototype.hasOwnProperty.call(body, "minimumVersion")) {
    return NextResponse.json({ error: "minimumVersion is required" }, { status: 400 });
  }
  if (body.minimumVersion !== null && typeof body.minimumVersion !== "string") {
    return NextResponse.json({ error: "invalid minimumVersion" }, { status: 400 });
  }
  try {
    const policy = await saveRelayMinimumClientVersion(
      typeof body.minimumVersion === "string" ? body.minimumVersion : null,
    );
    return NextResponse.json({ ok: true, ...policy });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to save client version policy";
    const status = message === "invalid client version" ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
