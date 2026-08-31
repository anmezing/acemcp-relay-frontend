import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("user-facing hardcoding policy", () => {
  const userFacingFiles = [
    "app/page.tsx",
    "app/console/page.tsx",
    "components/CurrentVersionTab.tsx",
    "docs/cloud-index-troubleshooting.md",
    "messages/en.json",
    "messages/zh-CN.json",
  ];

  it("does not prescribe one host, instruction filename, or installation command", () => {
    const text = userFacingFiles.map(read).join("\n");
    for (const forbidden of [
      /VS Code/i,
      /CLAUDE\.md/,
      /AGENTS\.md/,
      /\.cursor\/rules/,
      /npm install -g/,
      /\bnpx\b/i,
      /codebase_index_status/,
    ]) {
      expect(text).not.toMatch(forbidden);
    }
  });


  it("keeps host-specific launcher commands out of tracked repository configuration", () => {
    const gitignore = read(".gitignore");
    expect(gitignore).toContain("/.mcp.json");
    expect(gitignore).toContain("/.codex/config.toml");
    expect(read("lib/credential-auth.ts")).not.toMatch(/MIN_PASSWORD_LENGTH|MAX_PASSWORD_LENGTH|count:\s*(?:8|128)/);
    expect(read("app/login/page.tsx")).toContain("passwordPolicyFromResponse");
  });

  it("does not copy configurable index limit values into presentation text", () => {
    const text = userFacingFiles.map(read).join("\n");
    expect(text).not.toMatch(/100,000|100000 files|512 KiB|524288 byte/i);
  });


  it("keeps launch syntax and model payload bounds in their policy owners", () => {
    const launchFiles = ["lib/lce-client.ts", "lib/mcp-config.ts"];
    const launchText = launchFiles.map(read).join("\n");
    expect(launchText).not.toMatch(/\bnpx\b|["']-y["']/i);

    const boundedPayloadFiles = [
      "app/api/admin/model-config/route.ts",
      "app/api/admin/model-config/models/route.ts",
      "app/api/model-config/models/route.ts",
      "lib/platform-model-config.ts",
    ];
    const payloadText = boundedPayloadFiles.map(read).join("\n");
    expect(payloadText).not.toMatch(/64\s*\*\s*1024|1024\s*\*\s*1024/);
  });

  it("keeps auth, mail, payment, storage, quota, and time policy in named owners", () => {
    const operationalConsumers = [
      "lib/auth.ts",
      "lib/email-verification.ts",
      "lib/payments.ts",
      "lib/billing.ts",
      "lib/db.ts",
      "app/api/admin/orgs/route.ts",
      "app/api/admin/quotas/route.ts",
      "app/api/org/member-quota/route.ts",
    ];
    const text = operationalConsumers.map(read).join("\n");
    for (const forbidden of [
      /localhost:5432/,
      /localhost:6379/,
      /maxConnections:\s*3/,
      /maxMessages:\s*100/,
      /connectionTimeout:\s*10_000/,
      /greetingTimeout:\s*10_000/,
      /socketTimeout:\s*20_000/,
      /https:\/\/api\.mch\.weixin\.qq\.com/,
      /8\s*\*\s*60\s*\*\s*60/,
      /1_000_000_000/,
      /10_000_000/,
    ]) {
      expect(text).not.toMatch(forbidden);
    }
    expect(read("lib/auth.ts")).toContain("authRuntimePolicy");
    expect(read("lib/email-verification.ts")).toContain("smtpRuntimePolicy");
    expect(read("lib/payments.ts")).toContain("paymentRuntimePolicy");
    expect(read("lib/db.ts")).toContain("nextZonedDayBoundary");
    expect(text).toContain("quota-policy");
  });

  it("keeps provider protocol endpoints in one named preset owner", () => {
    const endpointOwners = [
      "lib/model-provider-presets.ts",
      "lib/auth-provider-presets.ts",
      "lib/server-runtime-config.ts",
    ];
    const productionFiles = fs
      .readdirSync(path.join(root, "lib"), { recursive: true })
      .filter((entry): entry is string => typeof entry === "string" && /\.ts$/.test(entry))
      .map((entry) => path.join("lib", entry))
      .filter((file) => !file.endsWith(".test.ts"));
    const endpointNeedles = [
      "https://api.voyageai.com/v1/embeddings",
      "https://api.voyageai.com/v1/rerank",
      "https://api.siliconflow.cn/v1/rerank",
      "https://connect.linux.do/oauth2/authorize",
      "https://connect.linuxdo.org/oauth2/token",
      "https://connect.linuxdo.org/api/user",
      "https://api.mch.weixin.qq.com",
      "https://registry.npmjs.org",
    ];
    for (const endpoint of endpointNeedles) {
      const owners = productionFiles.filter((file) => read(file).includes(endpoint));
      expect(owners).toHaveLength(1);
      expect(endpointOwners).toContain(owners[0].replaceAll("\\", "/"));
    }
    expect(read("lib/rerank-providers.ts")).toContain("PROVIDER_ENDPOINTS");
    expect(read("lib/auth.ts")).toContain("LINUXDO_OAUTH_PROVIDER");
  });

  it("does not duplicate provider dimensions or key-pool capacity in translations", () => {
    const messages = ["messages/en.json", "messages/zh-CN.json"].map(read).join("\n");
    expect(messages).not.toMatch(/currently 1024|当前固定为 1024|up to 100 keys|最多 100 个/i);
    expect(messages).toContain("{p0}");
  });

  it("keeps the internal relay default in the centralized runtime module", () => {
    const productionFiles = [
      ...fs.readdirSync(path.join(root, "app"), { recursive: true })
        .filter((entry): entry is string => typeof entry === "string" && /\.(?:ts|tsx)$/.test(entry))
        .map((entry) => path.join("app", entry)),
      ...fs.readdirSync(path.join(root, "lib"), { recursive: true })
        .filter((entry): entry is string => typeof entry === "string" && /\.ts$/.test(entry))
        .map((entry) => path.join("lib", entry)),
    ].filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"));
    const offenders = productionFiles.filter((file) => {
      const normalized = file.replaceAll("\\", "/");
      return normalized !== "lib/server-runtime-config.ts" && read(file).includes("http://relay:3009");
    });
    expect(offenders).toEqual([]);
  });
  it("keeps status visualization capacity aligned with client runtime policy", () => {
    const statusPage = read("app/status/page.tsx");
    expect(statusPage).toContain("CLIENT_RUNTIME_POLICY.healthHistoryLimit");
    expect(statusPage).not.toContain("const TOTAL_BARS = 60");
  });

});
