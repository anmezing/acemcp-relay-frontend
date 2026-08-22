import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  AGENT_RULES_CLOUD,
  AGENT_RULES_REMOTE,
  CLOUD_TOOLS,
  NPM_LOCAL_TOOLS,
  REMOTE_TOOLS,
} from "@/lib/agent-rules";

// 跨仓库契约钉住测试：lce 仓库 docs/contracts/cloud-protocol.json 是云协议
// 的单一源头（cloudToolSurface = 客户端实际暴露的云端工具名）。本测试
// 断言 Agent 规则与工具面定义和契约一致，防止配置说明与客户端实际能力漂移。
// 契约文件在 sibling 仓库中；找不到时 skip（如 CI 单独 checkout 本仓库）。

const CANDIDATES = [
  "../lce-clean-20260704-213701/docs/contracts/cloud-protocol.json",
  "../lce/docs/contracts/cloud-protocol.json",
];

function findContract(): string | null {
  for (const rel of CANDIDATES) {
    const p = path.resolve(import.meta.dirname, "..", rel);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const contractPath = findContract();

describe.skipIf(!contractPath)(
  "cloud-protocol 契约钉住（sibling lce 仓库缺席时跳过）",
  () => {
    function loadSurface(): string[] {
      const raw = JSON.parse(fs.readFileSync(contractPath!, "utf8"));
      const surface = raw.cloudToolSurface;
      expect(Array.isArray(surface)).toBe(true);
      expect(surface.length).toBeGreaterThan(0);
      return surface;
    }

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
  }
);

describe("remote HTTP and npm client tool surfaces", () => {
  it("documents the two tools that require the npm client", () => {
    expect(NPM_LOCAL_TOOLS.map((tool) => tool.name)).toEqual([
      "codebase_git_context",
      "codebase_review_changes",
    ]);
    expect(CLOUD_TOOLS.filter(
      (tool) => !REMOTE_TOOLS.some((remoteTool) => remoteTool.name === tool.name),
    ).map((tool) => tool.name)).toEqual(NPM_LOCAL_TOOLS.map((tool) => tool.name));
    expect(NPM_LOCAL_TOOLS.every((tool) => tool.location === "local")).toBe(true);
    expect(AGENT_RULES_CLOUD).not.toContain("（服务端）");
    expect(AGENT_RULES_CLOUD).not.toContain("（本地 npm 客户端）");
    expect(AGENT_RULES_CLOUD).not.toContain("npm 客户端");
  });

  it("keeps all remote business tools in the remote list and rules", () => {
    for (const name of ["codebase-retrieval", "codebase_symbol_graph", "codebase_enhance_prompt", "codebase_index"]) {
      expect(REMOTE_TOOLS.some((tool) => tool.name === name)).toBe(true);
      expect(AGENT_RULES_REMOTE).toContain(`\`${name}\``);
    }
    expect(REMOTE_TOOLS.every((tool) => tool.location === "server")).toBe(true);
    expect(AGENT_RULES_REMOTE).toContain("代码发生变化或切换分支后");
  });

  it("tells agents exactly when and how to call prompt enhancement", () => {
    for (const rules of [AGENT_RULES_CLOUD, AGENT_RULES_REMOTE]) {
      expect(rules).toContain("当用户明确要求增强/优化提示词");
      expect(rules).toContain("`prompt`");
      expect(rules).toContain("`technical_terms`");
      expect(rules).toContain("原始要求始终优先");
      expect(rules).toContain("不要对每个普通任务自动调用");
    }
  });
});
