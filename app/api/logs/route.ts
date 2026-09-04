import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  countRequestLogs,
  getRequestLogs,
  getRequestLogStats,
} from "@/lib/db";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function positiveInteger(raw: string | null, fallback: number, max?: number): number {
  if (raw === null || !/^\d+$/.test(raw)) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return max ? Math.min(parsed, max) : parsed;
}

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const requestedPage = positiveInteger(searchParams.get("page"), 1);
    const limit = positiveInteger(
      searchParams.get("limit"),
      DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE
    );
    const withStats = searchParams.get("withStats") === "true";

    // 精确总数既用于分页，也用于把越界页夹回最后一页。总数和首屏统计
    // 均来自按 user_id 维护的汇总行，正常翻页不会对历史日志执行 COUNT(*)。
    const stats = withStats ? await getRequestLogStats(session.user.id) : null;
    const totalCount =
      stats?.totalCount ?? (await countRequestLogs(session.user.id));
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));
    const page = Math.min(requestedPage, totalPages);
    const offset = (page - 1) * limit;
    const logs = await getRequestLogs(session.user.id, limit, offset);

    return NextResponse.json({
      ...(withStats ? { stats } : {}),
      logs: logs.map((log) => ({
        id: log.id,
        status: log.status,
        statusCode: log.status_code,
        requestPath: log.request_path,
        requestMethod: log.request_method,
        requestTimestamp: log.request_timestamp,
        responseDurationMs: log.response_duration_ms,
        clientIp: log.client_ip,
      })),
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages,
      },
    });
  } catch (error) {
    console.error("获取请求日志失败:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
