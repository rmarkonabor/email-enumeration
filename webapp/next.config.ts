import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  adapterPath: process.env.VERCEL ? require.resolve("@vercel/next") : undefined,
};

export default nextConfig;
