import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { initDB, deviceLogin, isUserBanned } from "@/lib/db";

export async function GET(request: NextRequest) {
  // 请求时惰性初始化（幂等）；模块级调用会在 next build 期连不上库
  await initDB().catch(console.error);
  const callback = request.nextUrl.searchParams.get("callback");
  if (!callback) {
    return NextResponse.json(
      { error: "missing callback parameter" },
      { status: 400 }
    );
  }

  try {
    new URL(callback);
  } catch {
    return NextResponse.json(
      { error: "invalid callback URL" },
      { status: 400 }
    );
  }

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user?.id) {
    const returnUrl = request.nextUrl.toString();
    const loginUrl = new URL("/login", request.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", returnUrl);
    return NextResponse.redirect(loginUrl);
  }

  if (await isUserBanned(session.user.id)) {
    return new NextResponse(
      "<html><body><h2>账号已被禁用，请联系管理员。</h2></body></html>",
      { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  // 设备绑定：插件登录时带 device_id（vscode.env.machineId）。老客户端没有
  // 这个参数，跳过注册（relay 的 log 模式会放行并记告警）。
  // token 轮换规则见 deviceLogin：仅在这次登录踢掉了另一台设备时轮换。
  const rawDeviceId = request.nextUrl.searchParams.get("device_id")?.trim() || "";
  const deviceId = rawDeviceId && rawDeviceId.length <= 128 ? rawDeviceId : null;
  const deviceName =
    request.nextUrl.searchParams.get("device_name")?.trim().slice(0, 255) || null;

  const { keyRecord, evicted, rotated } = await deviceLogin(session.user.id, deviceId, deviceName);
  if (evicted.length > 0) {
    console.log(
      `Device login for user ${session.user.id}: registered ${deviceId}, evicted ${evicted.length} device(s)${rotated ? ", token rotated" : ""}`
    );
  }

  const target = new URL(callback);
  target.searchParams.set("token", keyRecord.api_key);
  return NextResponse.redirect(target.toString());
}
