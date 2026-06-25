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
  // Proxy Supabase through Next.js so the browser never needs to reach the
  // internal Tailscale IP directly (avoids mixed-content and network issues).
  async rewrites() {
    const supabaseOrigin = process.env.SUPABASE_URL ?? "http://100.66.83.22:8010";
    return [
      {
        source: "/api/supa/:path*",
        destination: `${supabaseOrigin}/:path*`,
      },
    ];
  },
};

export default nextConfig;
