import { NextResponse } from "next/server";
import { getSystemSetting } from "@/lib/db";
import { DEFAULT_MENU_VISIBILITY, normalizeMenuVisibility } from "@/lib/menu-config";

export async function GET() {
  const stored = await getSystemSetting("console_menu_visibility");
  if (!stored) return NextResponse.json({ visibility: DEFAULT_MENU_VISIBILITY });
  try {
    return NextResponse.json({ visibility: normalizeMenuVisibility(JSON.parse(stored)) });
  } catch {
    return NextResponse.json({ visibility: DEFAULT_MENU_VISIBILITY });
  }
}
