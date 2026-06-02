import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Self-contained server build for the king Docker image (off Vercel).
  output: "standalone",
  // Monorepo: trace from the workspace root so zapi-shared is bundled.
  outputFileTracingRoot: path.join(import.meta.dirname, "..", ".."),
  typescript: {
    // Enforced at build time; use `bun run typecheck` locally to surface
    // errors before pushing. Flip to true only when debugging a broken CI.
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
