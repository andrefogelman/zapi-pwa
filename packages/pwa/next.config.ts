import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // Enforced at build time; use `bun run typecheck` locally to surface
    // errors before pushing. Flip to true only when debugging a broken CI.
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
