import { createHash } from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import { smtpRuntimePolicy, type SmtpRuntimePolicy } from "@/lib/server-runtime-config";

export interface VerificationEmailInput {
  email: string;
  name?: string | null;
  verificationUrl: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
}

function parseBoolean(value: string | undefined): boolean | null {
  if (value === undefined || value.trim() === "") return null;
  if (/^(1|true|yes)$/i.test(value.trim())) return true;
  if (/^(0|false|no)$/i.test(value.trim())) return false;
  return null;
}

export function smtpConfigFromEnv(env: Partial<NodeJS.ProcessEnv> = process.env): SmtpConfig | null {
  const host = env.SMTP_HOST?.trim();
  const from = env.SMTP_FROM?.trim();
  if (!host || !from) return null;

  const secureValue = parseBoolean(env.SMTP_SECURE);
  if (env.SMTP_SECURE?.trim() && secureValue === null) return null;
  const secure = secureValue ?? false;
  const portRaw = env.SMTP_PORT?.trim();
  const port = portRaw ? Number(portRaw) : secure ? 465 : 587;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) return null;

  const user = env.SMTP_USER?.trim();
  const password = env.SMTP_PASSWORD;
  if (Boolean(user) !== Boolean(password)) return null;

  return {
    host,
    port,
    secure,
    ...(user && password ? { user, password } : {}),
    from,
  };
}

export function isEmailVerificationConfigured(env: Partial<NodeJS.ProcessEnv> = process.env): boolean {
  return smtpConfigFromEnv(env) !== null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}

let cachedTransporter: Transporter | null = null;
let cachedTransportKey = "";

function getTransporter(config: SmtpConfig, policy: SmtpRuntimePolicy): Transporter {
  const key = createHash("sha256").update(JSON.stringify({
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.user ?? "",
    password: config.password ?? "",
    policy,
  })).digest("hex");
  if (cachedTransporter && cachedTransportKey === key) return cachedTransporter;
  if (cachedTransporter) cachedTransporter.close();

  cachedTransporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    pool: true,
    maxConnections: policy.maxConnections,
    maxMessages: policy.maxMessages,
    connectionTimeout: policy.connectionTimeoutMs,
    greetingTimeout: policy.greetingTimeoutMs,
    socketTimeout: policy.socketTimeoutMs,
    ...(config.user && config.password
      ? { auth: { user: config.user, pass: config.password } }
      : {}),
  });
  cachedTransportKey = key;
  return cachedTransporter;
}

export async function sendAccountVerificationEmail(
  input: VerificationEmailInput,
  env: Partial<NodeJS.ProcessEnv> = process.env,
): Promise<void> {
  const config = smtpConfigFromEnv(env);
  if (!config) throw new Error("EMAIL_VERIFICATION_UNAVAILABLE");

  const policy = smtpRuntimePolicy(env);
  const displayName = input.name?.trim() || "LCE 用户";
  const safeName = escapeHtml(displayName);
  const safeUrl = escapeHtml(input.verificationUrl);
  await getTransporter(config, policy).sendMail({
    from: config.from,
    to: input.email,
    subject: "验证你的 LCE 邮箱 / Verify your LCE email",
    text: [
      `${displayName}，你好：`,
      "请打开下面的链接验证邮箱，验证完成后才能登录 LCE。链接有效期由服务端策略控制：",
      input.verificationUrl,
      "",
      "If you did not create an LCE account, ignore this email.",
    ].join("\n"),
    html: `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;color:#172033;line-height:1.6"><h2>验证你的 LCE 邮箱</h2><p>${safeName}，你好：</p><p>验证邮箱后即可登录 LCE。链接有效期由服务端策略控制。</p><p><a href="${safeUrl}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#06b6d4;color:#04121a;text-decoration:none;font-weight:600">验证邮箱</a></p><p style="font-size:12px;color:#64748b;word-break:break-all">${safeUrl}</p><hr style="border:0;border-top:1px solid #e2e8f0"><p style="font-size:12px;color:#64748b">If you did not create an LCE account, ignore this email.</p></body></html>`,
  });
}
