import { afterEach, describe, expect, it } from "vitest";
import {
  adminLogPageSize,
  applicationBaseUrl,
  applicationTimeZone,
  authRuntimePolicy,
  clientVersionCacheSeconds,
  modelConfigSaveProxyTimeoutMs,
  modelDiscoveryResultLimit,
  packageRegistryBaseUrl,
  packageRegistryMetadataUrl,
  paymentRuntimePolicy,
  platformModelConfigBodyLimitBytes,
  platformModelConfigResponseLimitBytes,
  postgresConnectionOptions,
  providerModelDiscoveryResponseLimitBytes,
  redisConnectionUrl,
  relayOrigin,
  relayRequestTimeoutMs,
  relayUrl,
  siteMetadataUrl,
  smtpRuntimePolicy,
} from "@/lib/server-runtime-config";

const ENV_KEYS = [
  "LCE_RELAY_URL",
  "LCE_RELAY_REQUEST_TIMEOUT_MS",
  "LCE_MODEL_CONFIG_SAVE_PROXY_TIMEOUT_MS",
  "NEXT_PUBLIC_SITE_URL",
  "BETTER_AUTH_URL",
  "LCE_PACKAGE_REGISTRY_URL",
  "LCE_NPM_REGISTRY_URL",
  "LCE_CLIENT_VERSION_CACHE_SECONDS",
  "LCE_MODEL_DISCOVERY_RESULT_LIMIT",
  "LCE_ADMIN_LOG_PAGE_SIZE",
  "APPLICATION_TIMEZONE",
  "LCE_PLATFORM_MODEL_CONFIG_BODY_LIMIT_BYTES",
  "LCE_PLATFORM_MODEL_CONFIG_RESPONSE_LIMIT_BYTES",
  "LCE_PROVIDER_MODEL_DISCOVERY_RESPONSE_LIMIT_BYTES",
  "AUTH_MIN_PASSWORD_LENGTH",
  "AUTH_MAX_PASSWORD_LENGTH",
  "AUTH_EMAIL_VERIFICATION_TTL_SECONDS",
  "AUTH_ORGANIZATION_INVITATION_TTL_SECONDS",
  "AUTH_GITHUB_MIN_ACCOUNT_AGE_DAYS",
  "SMTP_MAX_CONNECTIONS",
  "SMTP_MAX_MESSAGES",
  "SMTP_CONNECTION_TIMEOUT_MS",
  "SMTP_GREETING_TIMEOUT_MS",
  "SMTP_SOCKET_TIMEOUT_MS",
  "PAYMENT_PROVIDER_REQUEST_TIMEOUT_MS",
  "PAYMENT_WEBHOOK_MAX_AGE_SECONDS",
  "PAYMENT_ORDER_TTL_MINUTES",
  "WECHAT_PAY_API_BASE_URL",
  "POSTGRES_HOST",
  "POSTGRES_PORT",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "POSTGRES_DB",
  "REDIS_URL",
  "REDIS_HOST",
  "REDIS_PORT",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("server runtime config", () => {
  it("normalizes one relay origin for all server routes", () => {
    process.env.LCE_RELAY_URL = "http://relay.internal:9000/";
    expect(relayOrigin()).toBe("http://relay.internal:9000");
    expect(relayUrl("internal/policy")).toBe("http://relay.internal:9000/internal/policy");
  });

  it("uses configurable positive timeout budgets", () => {
    process.env.LCE_RELAY_REQUEST_TIMEOUT_MS = "25000";
    process.env.LCE_MODEL_CONFIG_SAVE_PROXY_TIMEOUT_MS = "180000";
    expect(relayRequestTimeoutMs()).toBe(25_000);
    expect(modelConfigSaveProxyTimeoutMs()).toBe(180_000);
    process.env.LCE_RELAY_REQUEST_TIMEOUT_MS = "0";
    expect(() => relayRequestTimeoutMs()).toThrow(/positive integer/);
  });

  it("uses one configured application origin for auth and metadata", () => {
    process.env.BETTER_AUTH_URL = "https://auth.example.test";
    expect(applicationBaseUrl()).toBe("https://auth.example.test");
    expect(siteMetadataUrl().origin).toBe("https://auth.example.test");
    process.env.NEXT_PUBLIC_SITE_URL = "https://console.example.test";
    expect(siteMetadataUrl().origin).toBe("https://console.example.test");
  });

  it("validates the shared application time zone", () => {
    process.env.APPLICATION_TIMEZONE = "UTC";
    expect(applicationTimeZone()).toBe("UTC");
    process.env.APPLICATION_TIMEZONE = "not a timezone";
    expect(() => applicationTimeZone()).toThrow(/unsupported characters|valid IANA/);
  });

  it("configures the package registry, caching, and bounded result/page sizes", () => {
    process.env.LCE_PACKAGE_REGISTRY_URL = "https://packages.example.test/npm/";
    process.env.LCE_CLIENT_VERSION_CACHE_SECONDS = "120";
    process.env.LCE_MODEL_DISCOVERY_RESULT_LIMIT = "250";
    process.env.LCE_ADMIN_LOG_PAGE_SIZE = "75";
    expect(packageRegistryBaseUrl()).toBe("https://packages.example.test/npm");
    expect(packageRegistryMetadataUrl("@scope/client", "next")).toBe(
      "https://packages.example.test/npm/%40scope%2Fclient/next",
    );
    expect(clientVersionCacheSeconds()).toBe(120);
    expect(modelDiscoveryResultLimit()).toBe(250);
    expect(adminLogPageSize()).toBe(75);
  });

  it("centralizes request and provider response bounds", () => {
    process.env.LCE_PLATFORM_MODEL_CONFIG_BODY_LIMIT_BYTES = "131072";
    process.env.LCE_PLATFORM_MODEL_CONFIG_RESPONSE_LIMIT_BYTES = "262144";
    process.env.LCE_PROVIDER_MODEL_DISCOVERY_RESPONSE_LIMIT_BYTES = "2097152";
    expect(platformModelConfigBodyLimitBytes()).toBe(131_072);
    expect(platformModelConfigResponseLimitBytes()).toBe(262_144);
    expect(providerModelDiscoveryResponseLimitBytes()).toBe(2_097_152);
    process.env.LCE_PLATFORM_MODEL_CONFIG_BODY_LIMIT_BYTES = "0";
    expect(() => platformModelConfigBodyLimitBytes()).toThrow(/positive integer/);
  });

  it("centralizes authentication lifetime and password policy", () => {
    const policy = authRuntimePolicy({
      AUTH_MIN_PASSWORD_LENGTH: "12",
      AUTH_MAX_PASSWORD_LENGTH: "10",
      AUTH_EMAIL_VERIFICATION_TTL_SECONDS: "7200",
      AUTH_ORGANIZATION_INVITATION_TTL_SECONDS: "86400",
      AUTH_GITHUB_MIN_ACCOUNT_AGE_DAYS: "0",
    });
    expect(policy).toEqual({
      minPasswordLength: 12,
      maxPasswordLength: 12,
      emailVerificationTtlSeconds: 7200,
      organizationInvitationTtlSeconds: 86400,
      githubMinAccountAgeDays: 0,
    });
    expect(() => authRuntimePolicy({ AUTH_MIN_PASSWORD_LENGTH: "0" })).toThrow(
      /positive integer/,
    );
  });

  it("centralizes SMTP and payment operational budgets", () => {
    expect(
      smtpRuntimePolicy({
        SMTP_MAX_CONNECTIONS: "5",
        SMTP_MAX_MESSAGES: "250",
        SMTP_CONNECTION_TIMEOUT_MS: "15000",
        SMTP_GREETING_TIMEOUT_MS: "16000",
        SMTP_SOCKET_TIMEOUT_MS: "30000",
      }),
    ).toEqual({
      maxConnections: 5,
      maxMessages: 250,
      connectionTimeoutMs: 15000,
      greetingTimeoutMs: 16000,
      socketTimeoutMs: 30000,
    });
    expect(
      paymentRuntimePolicy({
        PAYMENT_PROVIDER_REQUEST_TIMEOUT_MS: "20000",
        PAYMENT_WEBHOOK_MAX_AGE_SECONDS: "600",
        PAYMENT_ORDER_TTL_MINUTES: "30",
        WECHAT_PAY_API_BASE_URL: "https://pay.example.test",
      }),
    ).toEqual({
      providerRequestTimeoutMs: 20000,
      webhookMaxAgeSeconds: 600,
      orderTtlMinutes: 30,
      wechatPayApiBaseUrl: "https://pay.example.test",
    });
  });

  it("centralizes PostgreSQL and Redis connection defaults and overrides", () => {
    expect(
      postgresConnectionOptions({
        POSTGRES_HOST: "db.internal",
        POSTGRES_PORT: "6432",
        POSTGRES_USER: "console",
        POSTGRES_PASSWORD: "secret",
        POSTGRES_DB: "lce",
      }),
    ).toEqual({
      host: "db.internal",
      port: 6432,
      user: "console",
      password: "secret",
      database: "lce",
    });
    expect(redisConnectionUrl({ REDIS_HOST: "cache.internal", REDIS_PORT: "6380" })).toBe(
      "redis://cache.internal:6380",
    );
    expect(
      redisConnectionUrl({
        REDIS_URL: "rediss://user:secret@cache.example:6380/1",
        REDIS_HOST: "ignored",
      }),
    ).toBe("rediss://user:secret@cache.example:6380/1");
  });
});
