import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { initDB, createApiKey } from "@/lib/db";

// 为控制台「一键复制 MCP 配置」提供 apiKey（已有 key 时复用，没有则创建，
// 绝不轮换）。设备绑定功能已从 relay 移除，本端点不再登记设备、也不再返回
// 设备 ID——前端只消费 apiKey 字段。
export async function POST() {
  try {
    await initDB().catch(console.error);
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const keyRecord = await createApiKey(session.user.id);

    return NextResponse.json({
      apiKey: keyRecord.api_key,
    });
  } catch (error) {
    console.error("获取 MCP 配置失败:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
