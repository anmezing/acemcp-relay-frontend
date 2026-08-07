import { defineConfig } from "vitest/config";
import path from "node:path";

// 服务端 lib/* 的单元测试。这里刻意只跑 Node 环境的纯逻辑模块（SSRF 防护、
// 凭据、配置构造），不加载 jsdom / React：这些模块是安全边界，值得独立
// 于 UI 快速回归。
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
    },
  },
});
