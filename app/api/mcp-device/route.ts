import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { randomBytes } from "crypto";
import { auth } from "@/lib/auth";
import { initDB, getDevices, deviceLogin } from "@/lib/db";

// 为控制台「一键复制 MCP 配置」提供 (deviceId, apiKey)。
// 生产 relay 为 enforce 模式，配置里必须带已登记的 X-Client-Id：
// - 已有在册设备时复用最近活跃的那台——绝不能无故新造设备，单设备模式下
//   新登记会把现有 MCP 客户端踢掉并轮换 token；
// - 没有任何在册设备时生成 web- 前缀的随机 ID 走 deviceLogin 登记
//   （空列表下注册不发生淘汰，token 不轮换）。
export async function POST() {
  try {
    await initDB().catch(console.error);
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const userId = session.user.id;

    const devices = await getDevices(userId);
    const deviceId =
      devices[0]?.device_id ?? `web-${randomBytes(16).toString("hex")}`;
    const deviceName = devices[0] ? null : "网页生成的 MCP 客户端";

    const { keyRecord } = await deviceLogin(userId, deviceId, deviceName);

    return NextResponse.json({
      deviceId,
      apiKey: keyRecord.api_key,
    });
  } catch (error) {
    console.error("获取 MCP 设备配置失败:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
