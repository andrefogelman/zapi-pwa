import { getUserFromToken } from "@/lib/supabase-server";

const WACLAW_URL = process.env.WACLAW_URL || "http://100.66.83.22:3100";
const WACLAW_API_KEY = process.env.WACLAW_API_KEY || "waclaw-dev-key";

async function proxyToWaclaw(request: Request, path: string) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const targetUrl = `${WACLAW_URL}/${path}${url.search}`;

  const res = await fetch(targetUrl, {
    method: request.method,
    headers: {
      "X-API-Key": WACLAW_API_KEY,
      "Content-Type": "application/json",
    },
    body: request.method !== "GET" ? await request.text() : undefined,
  });

  const data = await res.text();
  return new Response(data, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
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
