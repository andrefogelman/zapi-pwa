import { getUserFromToken } from "@/lib/supabase-server";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

async function proxyToWaclaw(request: Request, path: string) {
  const url = new URL(request.url);

  // Auth: prefer Authorization header, fall back to ?token= query param
  // (needed for media URLs used directly in <audio>/<img> src).
  let token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) token = url.searchParams.get("token") || undefined;
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Strip the token from the upstream search params so it never reaches waclaw
  const upstreamParams = new URLSearchParams(url.searchParams);
  upstreamParams.delete("token");
  const upstreamSearch = upstreamParams.toString();
  const targetUrl = `${env.WACLAW_URL}/${path}${upstreamSearch ? `?${upstreamSearch}` : ""}`;

  const upstream = await fetch(targetUrl, {
    method: request.method,
    headers: {
      "X-API-Key": env.WACLAW_API_KEY,
      ...(request.method !== "GET" && { "Content-Type": "application/json" }),
    },
    body: request.method !== "GET" ? await request.text() : undefined,
  });

  // Pass through Content-Type (binary streams for media, JSON otherwise)
  const contentType = upstream.headers.get("Content-Type") || "application/json";
  const cacheControl = upstream.headers.get("Cache-Control");
  const headers: Record<string, string> = { "Content-Type": contentType };
  if (cacheControl) headers["Cache-Control"] = cacheControl;

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxyToWaclaw(request, path.join("/"));
}

export async function POST(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxyToWaclaw(request, path.join("/"));
}

export async function DELETE(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxyToWaclaw(request, path.join("/"));
}

export async function PATCH(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxyToWaclaw(request, path.join("/"));
}
