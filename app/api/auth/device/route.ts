import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getApiKey, createApiKey } from "@/lib/db";

export async function GET(request: NextRequest) {
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

  let keyRecord = await getApiKey(session.user.id);
  if (!keyRecord) {
    keyRecord = await createApiKey(session.user.id);
  }

  const target = new URL(callback);
  target.searchParams.set("token", keyRecord.api_key);
  return NextResponse.redirect(target.toString());
}
