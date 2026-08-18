import { NextResponse } from "next/server";
import { countRegisteredUsers, getRegistrationLimit, isRegistrationDisabled } from "@/lib/db";

export async function GET() {
  const [disabled, count, limit] = await Promise.all([isRegistrationDisabled(), countRegisteredUsers(), getRegistrationLimit()]);
  return NextResponse.json({ enabled: !disabled && (limit === null || count < limit), count, limit });
}
