import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  AGENT_RULES_CLOUD,
  AGENT_RULES_CLOUD_EN,
  CLOUD_TOOLS,
  NPM_LOCAL_TOOLS,
} from "@/lib/agent-rules";

// 随仓提交的快照让独立 CI 也必须验证协议；缺文件会直接失败，不依赖
// sibling checkout。部署前再比较三仓摘要，保证快照与 LCE 单一源一致。
const contractPath = path.resolve(
  import.meta.dirname,
  "..",
  "contracts",
  "cloud-protocol.json",
);

describe(
  "cloud-protocol 契约钉住",
  () => {
    function loadSurface(): string[] {
      const raw = JSON.parse(fs.readFileSync(contractPath, "utf8"));
      const surface = raw.cloudToolSurface;
      expect(Array.isArray(surface)).toBe(true);
      expect(surface.length).toBeGreaterThan(0);
      return surface;
    }

    it("钉住无成本重复索引结果", () => {
      const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
      expect(contract.schemaVersion).toBe("1.9");
      expect(contract.codebaseIndex.startOutcomes).toEqual({
        created: {
          requiredFields: ["job"],
          optionalFields: ["pending_files", "deleted_files"],
          providerWork: "allowed",
        },
        unchanged: {
          requiredFields: ["unchanged"],
          providerWork: "forbidden",
        },
        busy: {
          requiredFields: ["busy", "busy_reason", "retry_after_seconds"],
          optionalFields: ["active_job"],
          reasons: ["active_job", "rate_limited"],
          providerWork: "forbidden",
        },
        busyRetryPolicy: "client_waits_without_consuming_failure_retry_budget",
      });
    });

    it("钉住索引失败诊断原子契约和错误响应字段", () => {
      const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
      expect(contract.codebaseIndex.requiredFields.fail).toEqual([
        "operation",
        "job_id",
        "error",
      ]);
      expect(contract.codebaseIndex.optionalFields.fail).toEqual([
        "error_code",
        "error_origin",
        "recovery",
      ]);
      expect(contract.codebaseIndex.failureDiagnostics).toMatchObject({
        fields: ["error_code", "error_origin", "recovery"],
        presenceRule: "all_or_none",
        invalidValueBehavior: "reject",
        missingFieldsBehavior: "relay_classifies_error_text_and_persists_result",
      });
      expect(contract.codebaseIndex.failureDiagnostics.codes.provider_invalid_request).toEqual({
        origin: "provider",
        recovery: "contact_admin",
      });
      expect(contract.responseEnvelope.optionalErrorShape).toEqual([
        "code",
        "retry_after_seconds",
      ]);
    });

    it("钉住客户端版本来源、最低版本策略与升级机制", () => {
      const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
      expect(contract.clientCompatibility).toMatchObject({
        package: "@anmezing/lce-cloud",
        latestVersionSource: "npm_dist_tag_latest",
        minimumVersionSource: "relay_persistent_runtime_policy_with_env_bootstrap",
        minimumVersionAdminConfigurable: true,
        indexStartRequiresClientVersionWhenMinimumConfigured: true,
        upgradeMechanism: "runtime_or_client_package_manager",
        restartRequiredAfterUpgrade: true,
      });
    });

    it("CLOUD_TOOLS 与契约 cloudToolSurface 完全一致", () => {
      const surface = loadSurface();
      const names = CLOUD_TOOLS.map((t) => t.name);
      expect([...names].sort()).toEqual([...surface].sort());
    });

    it("AGENT_RULES_CLOUD 文案包含且仅包含契约的工具名", () => {
      const surface = loadSurface();
      for (const name of surface) {
        expect(AGENT_RULES_CLOUD).toContain(`\`${name}\``);
      }
      // 仅包含：文案中出现的所有 codebase* 工具名标记都必须在契约内
      const mentioned = AGENT_RULES_CLOUD.match(/`(codebase[\w-]*)`/g) || [];
      const mentionedNames = [...new Set(mentioned.map((m) => m.slice(1, -1)))];
      expect([...mentionedNames].sort()).toEqual([...surface].sort());
    });

    it("钉住 deep graph 开放发现、调用关系默认值与有界算法文案", () => {
      const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
      expect(contract.deepGraph.input.optionalFields).toContain("target_symbol");
      expect(contract.deepGraph.input.defaults.relationship_types).toEqual([
        "CALLS",
        "DISPATCHES_TO",
        "CALL_BOUNDARY",
      ]);
      expect(contract.deepGraph.relationshipTypes).toEqual([
        "CALLS",
        "DISPATCHES_TO",
        "CALL_BOUNDARY",
        "TYPE_USES",
        "IMPLEMENTS",
        "EXTENDS",
        "IMPORTS",
        "REFERENCES",
        "DECLARES",
      ]);
      expect(contract.deepGraph.semantics).toContain("target_symbol is optional");
      expect(contract.deepGraph.semantics).toContain("bounded open discovery");

      for (const rules of [AGENT_RULES_CLOUD, AGENT_RULES_CLOUD_EN]) {
        expect(rules).toContain("target_symbol");
        expect(rules).toContain("CALLS");
        expect(rules).toContain("DISPATCHES_TO");
        expect(rules).toContain("CALL_BOUNDARY");
        expect(rules).toContain("bounded");
      }
      expect(AGENT_RULES_CLOUD).toContain("中心性文本优先使用符号名和源码位置");
      expect(AGENT_RULES_CLOUD_EN).toContain(
        "centrality text should prefer symbol names and source locations",
      );
      expect(AGENT_RULES_CLOUD).toContain("callers/callees 的 depth=1–3");
      expect(AGENT_RULES_CLOUD_EN).toContain("callers/callees with depth=1–3");
    });
  }
);

describe("npm client tool surface", () => {
  it("documents the two tools that require the npm client", () => {
    expect(NPM_LOCAL_TOOLS.map((tool) => tool.name)).toEqual([
      "codebase_git_context",
      "codebase_review_changes",
    ]);
    expect(NPM_LOCAL_TOOLS.every((tool) => tool.location === "local")).toBe(true);
    expect(AGENT_RULES_CLOUD).not.toContain("（服务端）");
    expect(AGENT_RULES_CLOUD).not.toContain("（本地 npm 客户端）");
    expect(AGENT_RULES_CLOUD).not.toContain("npm 客户端");
    expect(AGENT_RULES_CLOUD).toContain("不要先用 grep、rg 或逐文件浏览");
    expect(AGENT_RULES_CLOUD).not.toContain("如果不要先用");
  });

  it("tells agents exactly when and how to call prompt enhancement", () => {
    expect(AGENT_RULES_CLOUD).toContain("当用户明确要求增强/优化提示词");
    expect(AGENT_RULES_CLOUD).toContain("`prompt`");
    expect(AGENT_RULES_CLOUD).toContain("`technical_terms`");
    expect(AGENT_RULES_CLOUD).toContain("原始要求始终优先");
    expect(AGENT_RULES_CLOUD).toContain("不要对每个普通任务自动调用");
  });

  it("tells agents to report index state without sending users to the console", () => {
    expect(AGENT_RULES_CLOUD).toContain("`codebase_index_status`");
    expect(AGENT_RULES_CLOUD).toContain("`repo_path`");
    expect(AGENT_RULES_CLOUD).toContain("`root_id`");
    expect(AGENT_RULES_CLOUD).toContain("不要要求用户打开控制台确认");
  });
});
