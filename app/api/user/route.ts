import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export async function GET() {
  try {
    const requestHeaders = await headers();
    const session = await auth.api.getSession({
      headers: requestHeaders,
    });

    if (!session?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const user = session.user;
    const accounts = await auth.api.listUserAccounts({
      headers: requestHeaders,
    });

    return NextResponse.json({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      username: (user as { username?: string }).username,
      trustLevel: (user as { trustLevel?: number }).trustLevel,
      githubCreatedAt: (user as { githubCreatedAt?: string | Date | null }).githubCreatedAt,
      createdAt: user.createdAt,
      authProviders: [...new Set(accounts.map((account) => account.providerId))],
    });
  } catch (error) {
    console.error("获取用户信息失败:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
