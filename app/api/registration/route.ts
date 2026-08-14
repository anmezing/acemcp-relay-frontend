import { NextResponse } from "next/server";
import { isRegistrationDisabled } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ enabled: !(await isRegistrationDisabled()) });
}
