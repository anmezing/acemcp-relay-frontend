const DEFAULT_RELAY_ORIGIN = "http://relay:3009";
const DEFAULT_APPLICATION_BASE_URL = "http://localhost:3000";
const DEFAULT_PACKAGE_REGISTRY_URL = "https://registry.npmjs.org";
const DEFAULT_RELAY_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_MODEL_CONFIG_SAVE_PROXY_TIMEOUT_MS = 140_000;
const DEFAULT_MODEL_DISCOVERY_PROXY_TIMEOUT_MS = 30_000;
const DEFAULT_CLIENT_VERSION_CACHE_SECONDS = 900;
const DEFAULT_MODEL_DISCOVERY_RESULT_LIMIT = 500;
const DEFAULT_ADMIN_LOG_PAGE_SIZE = 50;
const DEFAULT_APPLICATION_TIMEZONE = "Asia/Shanghai";
const DEFAULT_PLATFORM_MODEL_CONFIG_BODY_LIMIT_BYTES = 64 * 1024;
const DEFAULT_PLATFORM_MODEL_CONFIG_RESPONSE_LIMIT_BYTES = 64 * 1024;
const DEFAULT_PROVIDER_MODEL_DISCOVERY_RESPONSE_LIMIT_BYTES = 1024 * 1024;
const DEFAULT_AUTH_MIN_PASSWORD_LENGTH = 8;
const DEFAULT_AUTH_MAX_PASSWORD_LENGTH = 128;
const DEFAULT_EMAIL_VERIFICATION_TTL_SECONDS = 60 * 60;
const DEFAULT_ORGANIZATION_INVITATION_TTL_SECONDS = 48 * 60 * 60;
const DEFAULT_GITHUB_MIN_ACCOUNT_AGE_DAYS = 365;
const DEFAULT_SMTP_MAX_CONNECTIONS = 3;
const DEFAULT_SMTP_MAX_MESSAGES = 100;
const DEFAULT_SMTP_CONNECTION_TIMEOUT_MS = 10_000;
const DEFAULT_SMTP_GREETING_TIMEOUT_MS = 10_000;
const DEFAULT_SMTP_SOCKET_TIMEOUT_MS = 20_000;
const DEFAULT_PAYMENT_PROVIDER_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_PAYMENT_WEBHOOK_MAX_AGE_SECONDS = 5 * 60;
const DEFAULT_PAYMENT_ORDER_TTL_MINUTES = 15;
const DEFAULT_WECHAT_PAY_API_BASE_URL = "https://api.mch.weixin.qq.com";
const DEFAULT_POSTGRES_HOST = "localhost";
const DEFAULT_POSTGRES_PORT = 5432;
const DEFAULT_POSTGRES_USER = "postgres";
const DEFAULT_POSTGRES_DATABASE = "postgres";
const DEFAULT_REDIS_HOST = "localhost";
const DEFAULT_REDIS_PORT = 6379;

type RuntimeEnv = Readonly<Record<string, string | undefined>>;

function positiveIntegerFromEnv(env: RuntimeEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function positiveIntegerEnv(name: string, fallback: number): number {
  return positiveIntegerFromEnv(process.env, name, fallback);
}

function nonNegativeIntegerFromEnv(env: RuntimeEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

export function relayOrigin(): string {
  return (process.env.LCE_RELAY_URL?.trim() || DEFAULT_RELAY_ORIGIN).replace(/\/+$/, "");
}

export function relayUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${relayOrigin()}${normalizedPath}`;
}

export function relayRequestTimeoutMs(): number {
  return positiveIntegerEnv("LCE_RELAY_REQUEST_TIMEOUT_MS", DEFAULT_RELAY_REQUEST_TIMEOUT_MS);
}

export function modelConfigSaveProxyTimeoutMs(): number {
  return positiveIntegerEnv(
    "LCE_MODEL_CONFIG_SAVE_PROXY_TIMEOUT_MS",
    DEFAULT_MODEL_CONFIG_SAVE_PROXY_TIMEOUT_MS,
  );
}

export function modelDiscoveryProxyTimeoutMs(): number {
  return positiveIntegerEnv(
    "LCE_MODEL_DISCOVERY_PROXY_TIMEOUT_MS",
    DEFAULT_MODEL_DISCOVERY_PROXY_TIMEOUT_MS,
  );
}

export function applicationBaseUrl(): string {
  return process.env.BETTER_AUTH_URL?.trim() || DEFAULT_APPLICATION_BASE_URL;
}

export function siteMetadataUrl(): URL {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim() || applicationBaseUrl();
  return new URL(configured);
}

export function packageRegistryBaseUrl(env: RuntimeEnv = process.env): string {
  return (
    env.LCE_PACKAGE_REGISTRY_URL?.trim() ||
    env.LCE_NPM_REGISTRY_URL?.trim() ||
    DEFAULT_PACKAGE_REGISTRY_URL
  ).replace(/\/+$/, "");
}

export function packageRegistryMetadataUrl(
  packageName: string,
  tag = "latest",
  env: RuntimeEnv = process.env,
): string {
  return `${packageRegistryBaseUrl(env)}/${encodeURIComponent(packageName)}/${encodeURIComponent(tag)}`;
}

export function clientVersionCacheSeconds(): number {
  return positiveIntegerEnv("LCE_CLIENT_VERSION_CACHE_SECONDS", DEFAULT_CLIENT_VERSION_CACHE_SECONDS);
}

export function modelDiscoveryResultLimit(): number {
  return positiveIntegerEnv("LCE_MODEL_DISCOVERY_RESULT_LIMIT", DEFAULT_MODEL_DISCOVERY_RESULT_LIMIT);
}

export function adminLogPageSize(): number {
  return positiveIntegerEnv("LCE_ADMIN_LOG_PAGE_SIZE", DEFAULT_ADMIN_LOG_PAGE_SIZE);
}

export function applicationTimeZone(): string {
  const value = process.env.APPLICATION_TIMEZONE?.trim() || DEFAULT_APPLICATION_TIMEZONE;
  if (!/^[A-Za-z0-9_+\-/]+$/.test(value)) {
    throw new Error("APPLICATION_TIMEZONE contains unsupported characters");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
  } catch {
    throw new Error("APPLICATION_TIMEZONE must be a valid IANA time zone");
  }
  return value;
}

export function platformModelConfigBodyLimitBytes(): number {
  return positiveIntegerEnv(
    "LCE_PLATFORM_MODEL_CONFIG_BODY_LIMIT_BYTES",
    DEFAULT_PLATFORM_MODEL_CONFIG_BODY_LIMIT_BYTES,
  );
}

export function platformModelConfigResponseLimitBytes(): number {
  return positiveIntegerEnv(
    "LCE_PLATFORM_MODEL_CONFIG_RESPONSE_LIMIT_BYTES",
    DEFAULT_PLATFORM_MODEL_CONFIG_RESPONSE_LIMIT_BYTES,
  );
}

export function providerModelDiscoveryResponseLimitBytes(): number {
  return positiveIntegerEnv(
    "LCE_PROVIDER_MODEL_DISCOVERY_RESPONSE_LIMIT_BYTES",
    DEFAULT_PROVIDER_MODEL_DISCOVERY_RESPONSE_LIMIT_BYTES,
  );
}

export interface AuthRuntimePolicy {
  minPasswordLength: number;
  maxPasswordLength: number;
  emailVerificationTtlSeconds: number;
  organizationInvitationTtlSeconds: number;
  githubMinAccountAgeDays: number;
}

export function authRuntimePolicy(env: RuntimeEnv = process.env): Readonly<AuthRuntimePolicy> {
  const minPasswordLength = positiveIntegerFromEnv(
    env,
    "AUTH_MIN_PASSWORD_LENGTH",
    DEFAULT_AUTH_MIN_PASSWORD_LENGTH,
  );
  const maxPasswordLength = Math.max(
    minPasswordLength,
    positiveIntegerFromEnv(env, "AUTH_MAX_PASSWORD_LENGTH", DEFAULT_AUTH_MAX_PASSWORD_LENGTH),
  );
  return Object.freeze({
    minPasswordLength,
    maxPasswordLength,
    emailVerificationTtlSeconds: positiveIntegerFromEnv(
      env,
      "AUTH_EMAIL_VERIFICATION_TTL_SECONDS",
      DEFAULT_EMAIL_VERIFICATION_TTL_SECONDS,
    ),
    organizationInvitationTtlSeconds: positiveIntegerFromEnv(
      env,
      "AUTH_ORGANIZATION_INVITATION_TTL_SECONDS",
      DEFAULT_ORGANIZATION_INVITATION_TTL_SECONDS,
    ),
    githubMinAccountAgeDays: nonNegativeIntegerFromEnv(
      env,
      "AUTH_GITHUB_MIN_ACCOUNT_AGE_DAYS",
      DEFAULT_GITHUB_MIN_ACCOUNT_AGE_DAYS,
    ),
  });
}

export interface SmtpRuntimePolicy {
  maxConnections: number;
  maxMessages: number;
  connectionTimeoutMs: number;
  greetingTimeoutMs: number;
  socketTimeoutMs: number;
}

export function smtpRuntimePolicy(env: RuntimeEnv = process.env): Readonly<SmtpRuntimePolicy> {
  return Object.freeze({
    maxConnections: positiveIntegerFromEnv(
      env,
      "SMTP_MAX_CONNECTIONS",
      DEFAULT_SMTP_MAX_CONNECTIONS,
    ),
    maxMessages: positiveIntegerFromEnv(env, "SMTP_MAX_MESSAGES", DEFAULT_SMTP_MAX_MESSAGES),
    connectionTimeoutMs: positiveIntegerFromEnv(
      env,
      "SMTP_CONNECTION_TIMEOUT_MS",
      DEFAULT_SMTP_CONNECTION_TIMEOUT_MS,
    ),
    greetingTimeoutMs: positiveIntegerFromEnv(
      env,
      "SMTP_GREETING_TIMEOUT_MS",
      DEFAULT_SMTP_GREETING_TIMEOUT_MS,
    ),
    socketTimeoutMs: positiveIntegerFromEnv(
      env,
      "SMTP_SOCKET_TIMEOUT_MS",
      DEFAULT_SMTP_SOCKET_TIMEOUT_MS,
    ),
  });
}

export interface PaymentRuntimePolicy {
  providerRequestTimeoutMs: number;
  webhookMaxAgeSeconds: number;
  orderTtlMinutes: number;
  wechatPayApiBaseUrl: string;
}

export function paymentRuntimePolicy(
  env: RuntimeEnv = process.env,
): Readonly<PaymentRuntimePolicy> {
  return Object.freeze({
    providerRequestTimeoutMs: positiveIntegerFromEnv(
      env,
      "PAYMENT_PROVIDER_REQUEST_TIMEOUT_MS",
      DEFAULT_PAYMENT_PROVIDER_REQUEST_TIMEOUT_MS,
    ),
    webhookMaxAgeSeconds: positiveIntegerFromEnv(
      env,
      "PAYMENT_WEBHOOK_MAX_AGE_SECONDS",
      DEFAULT_PAYMENT_WEBHOOK_MAX_AGE_SECONDS,
    ),
    orderTtlMinutes: positiveIntegerFromEnv(
      env,
      "PAYMENT_ORDER_TTL_MINUTES",
      DEFAULT_PAYMENT_ORDER_TTL_MINUTES,
    ),
    wechatPayApiBaseUrl:
      env.WECHAT_PAY_API_BASE_URL?.trim() || DEFAULT_WECHAT_PAY_API_BASE_URL,
  });
}

export interface PostgresConnectionOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function postgresConnectionOptions(
  env: RuntimeEnv = process.env,
): Readonly<PostgresConnectionOptions> {
  return Object.freeze({
    host: env.POSTGRES_HOST?.trim() || DEFAULT_POSTGRES_HOST,
    port: positiveIntegerFromEnv(env, "POSTGRES_PORT", DEFAULT_POSTGRES_PORT),
    user: env.POSTGRES_USER?.trim() || DEFAULT_POSTGRES_USER,
    password: env.POSTGRES_PASSWORD || "",
    database: env.POSTGRES_DB?.trim() || DEFAULT_POSTGRES_DATABASE,
  });
}

export function redisConnectionUrl(env: RuntimeEnv = process.env): string {
  const explicitUrl = env.REDIS_URL?.trim();
  if (explicitUrl) return explicitUrl;
  const host = env.REDIS_HOST?.trim() || DEFAULT_REDIS_HOST;
  const port = positiveIntegerFromEnv(env, "REDIS_PORT", DEFAULT_REDIS_PORT);
  return `redis://${host}:${port}`;
}
