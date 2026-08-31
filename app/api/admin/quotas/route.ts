import { NextRequest, NextResponse } from "next/server";
import {
  MAX_ADMIN_DAILY_INDEX_BYTES_LIMIT,
  MAX_ADMIN_DAILY_REQUEST_LIMIT,
} from "@/lib/quota-policy";
import { requireAdminSession } from "@/lib/admin";
import { listQuotas, setUserQuota } from "@/lib/admin-db";

function defaultDailyLimit(): number {
  const n = Number(process.env.DEFAULT_DAILY_REQUEST_LIMIT || "0");
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

function defaultDailyIndexBytesLimit(): number {
  const n = Number(process.env.DAILY_INDEX_BYTES_LIMIT || "0");
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

function proDailyLimit(): number {
  const n = Number(process.env.PRO_DAILY_REQUEST_LIMIT || "0");
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

function proDailyIndexBytesLimit(): number {
  const n = Number(process.env.PRO_DAILY_INDEX_BYTES_LIMIT || "0");
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

export async function GET() {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    return NextResponse.json({
      quotas: await listQuotas(),
      defaultLimit: defaultDailyLimit(),
      defaultIndexBytesLimit: defaultDailyIndexBytesLimit(),
      proLimit: proDailyLimit(),
      proIndexBytesLimit: proDailyIndexBytesLimit(),
    });
  } catch (error) {
    console.error("admin quotas failed:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

// null=恢复默认，0=不限，正整数=每日上限。
export async function POST(request: NextRequest) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let body: {
    userId?: string;
    requestLimit?: number | null;
    indexBytesLimit?: number | null;
  } = {};
  try {
    body = await request.json();
  } catch {}
  const userId = (body.userId || "").trim();
  if (!userId) {
    return NextResponse.json({ error: "missing userId" }, { status: 400 });
  }
  const parseLimit = (
    value: number | null | undefined,
    max: number
  ): number | null | undefined => {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max) {
      return undefined;
    }
    return parsed;
  };
  const requestLimit = parseLimit(body.requestLimit, MAX_ADMIN_DAILY_REQUEST_LIMIT);
  const indexBytesLimit = parseLimit(
    body.indexBytesLimit,
    MAX_ADMIN_DAILY_INDEX_BYTES_LIMIT
  );
  if (requestLimit === undefined || indexBytesLimit === undefined) {
    return NextResponse.json({ error: "invalid limit" }, { status: 400 });
  }
  try {
    await setUserQuota(userId, requestLimit, indexBytesLimit);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("admin set quota failed:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
