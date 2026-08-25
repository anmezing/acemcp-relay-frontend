import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  AGENT_RULES_CLOUD,
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
});
