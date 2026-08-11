import { defineConfig } from "vitest/config";
import path from "node:path";

// 服务端 lib/* 纯逻辑模块与 app/api/* 路由处理器的单元测试。这里刻意只跑
// Node 环境，不加载 jsdom / React：这些模块是安全边界（SSRF 防护、凭据、
// 代理鉴权），值得独立于 UI 快速回归。
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/api/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
    },
  },
});
