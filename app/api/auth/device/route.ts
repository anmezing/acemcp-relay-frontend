import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { initDB, deviceLogin, isUserBanned } from "@/lib/db";
import { DeviceCallbackError, validateDeviceCallback } from "@/lib/device-callback";

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

  // 这一步在签发凭据之前：下面会把 API key 拼到 callback 上重定向出去，
  // 只有指向用户本机的回环地址才是合法接收方（详见 lib/device-callback）。
  let target: URL;
  try {
    target = validateDeviceCallback(callback);
  } catch (error) {
    const message =
      error instanceof DeviceCallbackError ? error.message : "invalid callback URL";
    console.warn(
      `Rejected device-login callback from ip=${request.headers.get("x-forwarded-for") ?? "?"}: ${message}`
    );
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user?.id) {
    // 跳转基址必须用公网地址：容器内看到的 request origin 取决于代理是否
    // 正确传 Host 头，配置漂移时会拼出容器主机名（浏览器无法解析）。
    // callbackUrl 传站内相对路径：登录页只接受相对路径（防开放重定向），
    // 且相对路径由浏览器按登录页自身 origin 解析，天然就是公网地址。
    const publicOrigin = process.env.BETTER_AUTH_URL || request.nextUrl.origin;
    const loginUrl = new URL("/login", publicOrigin);
    loginUrl.searchParams.set(
      "callbackUrl",
      request.nextUrl.pathname + request.nextUrl.search
    );
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

  target.searchParams.set("token", keyRecord.api_key);
  return NextResponse.redirect(target.toString());
}
