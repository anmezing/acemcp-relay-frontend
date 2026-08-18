import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin";
import { getSystemSetting, setSystemSetting } from "@/lib/db";
import { CONSOLE_MENU_CATALOG, DEFAULT_MENU_VISIBILITY, normalizeMenuVisibility } from "@/lib/menu-config";

const KEY = "console_menu_visibility";
function read(value: string | null) {
  if (!value) return DEFAULT_MENU_VISIBILITY;
  try {
    return normalizeMenuVisibility(JSON.parse(value));
  } catch { return DEFAULT_MENU_VISIBILITY; }
}
export async function GET() {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ menus: CONSOLE_MENU_CATALOG, visibility: read(await getSystemSetting(KEY)) });
}
export async function POST(request: NextRequest) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null) as { visibility?: Record<string, unknown> } | null;
  if (!body?.visibility || typeof body.visibility !== "object") return NextResponse.json({ error: "missing visibility" }, { status: 400 });
  const visibility = Object.fromEntries(CONSOLE_MENU_CATALOG.map(({ id }) => [id, body.visibility?.[id] === true]));
  await setSystemSetting(KEY, JSON.stringify(visibility));
  return NextResponse.json({ ok: true, visibility });
}
