import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  getLeaderboard,
  getApplicationDateString,
  isValidLeaderboardDate,
} from "@/lib/db";
import { maskUsername } from "@/lib/utils";

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const requestedDate = searchParams.get("date");
    if (requestedDate !== null && !isValidLeaderboardDate(requestedDate)) {
      return NextResponse.json(
        { error: "日期格式无效" },
        { status: 400, headers: { "Cache-Control": "private, no-store" } }
      );
    }

    const targetDate = requestedDate || getApplicationDateString();
    const leaderboard = await getLeaderboard(targetDate);

    return NextResponse.json(
      {
        date: targetDate,
        entries: leaderboard.map((entry) => ({
          rank: entry.rank,
          userName: maskUsername(entry.user_name),
          requestCount: Number(entry.request_count),
          isCurrentUser: entry.user_id === session.user.id,
        })),
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error("获取排行榜失败:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
