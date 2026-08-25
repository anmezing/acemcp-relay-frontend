import { NextResponse } from "next/server";
import { countRegisteredUsers, getRegistrationLimit, isRegistrationDisabled } from "@/lib/db";
import { isEmailVerificationConfigured } from "@/lib/email-verification";

export async function GET() {
  const [disabled, count, limit] = await Promise.all([isRegistrationDisabled(), countRegisteredUsers(), getRegistrationLimit()]);
  return NextResponse.json(
    {
      enabled: !disabled && (limit === null || count < limit),
      emailRegistrationEnabled: isEmailVerificationConfigured(),
      count,
      limit,
    },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}
