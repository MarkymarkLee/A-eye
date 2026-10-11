import type { NextConfig } from "next";
import { securityHeaders } from "./lib/security-headers";

const config: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ["@a-eye/shared"],
  serverExternalPackages: ["web-push"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "picsum.photos" }, { protocol: "https", hostname: "fastly.picsum.photos" }],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({ dev: process.env.NODE_ENV !== "production" }),
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default config;
