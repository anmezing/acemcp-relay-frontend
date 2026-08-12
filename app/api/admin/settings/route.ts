import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin";
import { getSystemSetting, setSystemSetting } from "@/lib/db";
import { countUserModelConfigs } from "@/lib/model-config-db";
import { modelConfigEnabled } from "@/lib/model-config-crypto";

export async function GET() {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const registrationEnabled =
      (await getSystemSetting("registration_enabled")) !== "false";
    const customModelUsers = modelConfigEnabled()
      ? await countUserModelConfigs().catch(() => 0)
      : 0;
    return NextResponse.json({
      registrationEnabled,
      customRerank: { enabled: modelConfigEnabled(), userCount: customModelUsers },
    });
  } catch (error) {
    console.error("admin settings read failed:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

// body: { registrationEnabled: boolean }
export async function POST(request: NextRequest) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let body: { registrationEnabled?: boolean } = {};
  try {
    body = await request.json();
  } catch {}
  if (typeof body.registrationEnabled !== "boolean") {
    return NextResponse.json({ error: "missing registrationEnabled" }, { status: 400 });
  }
  try {
    await setSystemSetting(
      "registration_enabled",
      body.registrationEnabled ? "true" : "false"
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("admin settings write failed:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
