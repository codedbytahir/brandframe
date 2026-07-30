import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["lancedb", "apache-arrow"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.backblazeb2.com" },
      { protocol: "https", hostname: "test-streams.mux.dev" },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "250mb",
    },
  },
};

export default nextConfig;
