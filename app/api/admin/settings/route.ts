import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin";
import { countRegisteredUsers, getRegistrationLimit, getSystemSetting, setSystemSetting } from "@/lib/db";
import { countUserModelConfigs } from "@/lib/model-config-db";
import { modelConfigEnabled } from "@/lib/model-config-crypto";

export async function GET() {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const registrationEnabled =
      (await getSystemSetting("registration_enabled")) !== "false";
    const registrationLimit = await getRegistrationLimit();
    const registeredUsers = await countRegisteredUsers();
    const customModelUsers = modelConfigEnabled()
      ? await countUserModelConfigs().catch(() => 0)
      : 0;
    return NextResponse.json({
      registrationEnabled,
      registrationLimit,
      registeredUsers,
      customRerank: { enabled: modelConfigEnabled(), userCount: customModelUsers },
    });
  } catch (error) {
    console.error("admin settings read failed:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

// body: { registrationEnabled?: boolean; registrationLimit?: number | null }
export async function POST(request: NextRequest) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let body: { registrationEnabled?: boolean; registrationLimit?: number | null } = {};
  try {
    body = await request.json();
  } catch {}
  if (body.registrationEnabled === undefined && body.registrationLimit === undefined) return NextResponse.json({ error: "missing setting" }, { status: 400 });
  try {
    if (body.registrationEnabled !== undefined) await setSystemSetting("registration_enabled", body.registrationEnabled ? "true" : "false");
    if (body.registrationLimit !== undefined) {
      if (body.registrationLimit !== null && (!Number.isInteger(body.registrationLimit) || body.registrationLimit < 1)) return NextResponse.json({ error: "invalid registrationLimit" }, { status: 400 });
      await setSystemSetting("registration_max_users", body.registrationLimit === null ? "0" : String(body.registrationLimit));
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("admin settings write failed:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
