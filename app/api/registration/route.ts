import { NextResponse } from "next/server";
import {
  countRegisteredUsers,
  getRegistrationRemainingSlots,
  initRegistrationGate,
  isRegistrationDisabled,
} from "@/lib/db";
import { isEmailVerificationConfigured } from "@/lib/email-verification";

export async function GET() {
  await initRegistrationGate();
  const [disabled, count, remainingSlots] = await Promise.all([
    isRegistrationDisabled(),
    countRegisteredUsers(),
    getRegistrationRemainingSlots(),
  ]);
  return NextResponse.json(
    {
      enabled: !disabled && (remainingSlots === null || remainingSlots > 0),
      emailRegistrationEnabled: isEmailVerificationConfigured(),
      count,
      remainingSlots,
      // Compatibility for clients deployed before registrationSlots was introduced.
      limit: remainingSlots,
    },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}
