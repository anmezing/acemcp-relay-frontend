import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin";
import {
  countRegisteredUsers,
  getRegistrationRemainingSlots,
  getSystemSetting,
  initRegistrationGate,
  setRegistrationRemainingSlots,
  setSystemSetting,
} from "@/lib/db";
import { countUserModelConfigs } from "@/lib/model-config-db";
import { modelConfigEnabled } from "@/lib/model-config-crypto";

export async function GET() {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    await initRegistrationGate();
    const [registrationState, registrationSlots, registeredUsers, customModelUsers] =
      await Promise.all([
        getSystemSetting("registration_enabled"),
        getRegistrationRemainingSlots(),
        countRegisteredUsers(),
        modelConfigEnabled() ? countUserModelConfigs().catch(() => 0) : 0,
      ]);
    return NextResponse.json({
      registrationEnabled: registrationState !== "false",
      registrationSlots,
      // Rolling API compatibility: this field now carries remaining slots too.
      registrationLimit: registrationSlots,
      registeredUsers,
      customRerank: { enabled: modelConfigEnabled(), userCount: customModelUsers },
    });
  } catch (error) {
    console.error("admin settings read failed:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

type AdminSettingsBody = {
  registrationEnabled?: boolean;
  registrationSlots?: number | null;
  registrationLimit?: number | null;
};

// registrationSlots means how many NEW users may register after this save.
export async function POST(request: NextRequest) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let body: AdminSettingsBody = {};
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      body = parsed as AdminSettingsBody;
    }
  } catch {}

  const hasSlots = Object.prototype.hasOwnProperty.call(body, "registrationSlots");
  const hasLegacyLimit = Object.prototype.hasOwnProperty.call(body, "registrationLimit");
  if (body.registrationEnabled === undefined && !hasSlots && !hasLegacyLimit) {
    return NextResponse.json({ error: "missing setting" }, { status: 400 });
  }
  const registrationSlots = hasSlots ? body.registrationSlots : body.registrationLimit;
  if (
    (hasSlots || hasLegacyLimit) &&
    registrationSlots !== null &&
    (!Number.isSafeInteger(registrationSlots) || (registrationSlots ?? -1) < 0)
  ) {
    return NextResponse.json(
      { error: "invalid registrationSlots" },
      { status: 400 }
    );
  }

  try {
    await initRegistrationGate();
    if (body.registrationEnabled !== undefined) {
      await setSystemSetting(
        "registration_enabled",
        body.registrationEnabled ? "true" : "false"
      );
    }
    if (hasSlots || hasLegacyLimit) {
      await setRegistrationRemainingSlots(registrationSlots ?? null);
    }
    return NextResponse.json({
      ok: true,
      ...(hasSlots || hasLegacyLimit
        ? { registrationSlots, registrationLimit: registrationSlots }
        : {}),
    });
  } catch (error) {
    console.error("admin settings write failed:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
