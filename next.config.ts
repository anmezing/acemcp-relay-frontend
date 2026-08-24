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
