import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const outputMode = process.env.LCE_NEXT_OUTPUT?.trim().toLowerCase();
if (outputMode && outputMode !== "standalone" && outputMode !== "default") {
  throw new Error("LCE_NEXT_OUTPUT must be either 'standalone' or 'default'");
}

// Next's standalone tracer materializes pnpm dependencies with symlinks. On
// Windows that requires Developer Mode or an elevated token, neither of which
// should be a prerequisite for a local production build. Linux/macOS keep the
// deployable standalone output by default; an explicit environment override is
// available for non-Docker packaging and CI checks.
const standaloneOutput =
  outputMode === "standalone" || (outputMode !== "default" && process.platform !== "win32");

const nextConfig: NextConfig = {
  ...(standaloneOutput ? { output: "standalone" as const } : {}),
  // browserslist 只作用于应用代码，node_modules 默认不降级。intl-messageformat
  // （next-intl 的依赖）发布的是带 class static block 的产物，该语法在 Safari
  // 16.4 以下会在解析期抛 SyntaxError，整个 chunk 不执行、React 无法水合，页面
  // 只剩 SSR 内容与原生链接可用。必须显式转译它。
  transpilePackages: ["intl-messageformat"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "linux.do",
      },
      {
        protocol: "https",
        hostname: "*.linux.do",
      },
      {
        protocol: "https",
        hostname: "cdn.linux.do",
      },
    ],
  },
};

export default withNextIntl(nextConfig);
