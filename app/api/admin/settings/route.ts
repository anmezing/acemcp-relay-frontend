import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin";
import { getSystemSetting, setSystemSetting } from "@/lib/db";

// 模型配置只读展示：LCE 的模型由容器环境变量决定，改动需编辑 deploy/.env
// 并重启 lce，因此这里不提供在线修改。API key 一律不下发。
function modelConfig() {
  return {
    embeddings: {
      provider: process.env.EMBEDDINGS_PROVIDER || "",
      model: process.env.EMBEDDINGS_MODEL || "",
      baseUrl: process.env.EMBEDDINGS_BASE_URL || "",
    },
    rerank: {
      provider: process.env.RERANK_PROVIDER || "",
      model: process.env.RERANK_MODEL || "",
      baseUrl: process.env.RERANK_BASE_URL || "",
    },
  };
}

export async function GET() {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const registrationEnabled =
      (await getSystemSetting("registration_enabled")) !== "false";
    return NextResponse.json({
      registrationEnabled,
      models: modelConfig(),
    });
  } catch (error) {
    console.error("admin settings read failed:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

// body: { registrationEnabled: boolean }
export async function POST(request: NextRequest) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let body: { registrationEnabled?: boolean } = {};
  try {
    body = await request.json();
  } catch {}
  if (typeof body.registrationEnabled !== "boolean") {
    return NextResponse.json({ error: "missing registrationEnabled" }, { status: 400 });
  }
  try {
    await setSystemSetting(
      "registration_enabled",
      body.registrationEnabled ? "true" : "false"
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("admin settings write failed:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
