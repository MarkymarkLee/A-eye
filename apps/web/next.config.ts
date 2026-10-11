import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@a-eye/shared"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "picsum.photos" }, { protocol: "https", hostname: "fastly.picsum.photos" }],
  },
};

export default config;
