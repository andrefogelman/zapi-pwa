export const dynamic = "force-dynamic";

import { generateImage } from "@/lib/openai";
import { getUserFromToken } from "@/lib/supabase-server";

export async function POST(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return Response.json({ error: "prompt required" }, { status: 400 });
  }
  if (prompt.length > 1000) {
    return Response.json({ error: "prompt too long (max 1000 chars)" }, { status: 400 });
  }

  try {
    const { base64, mimeType } = await generateImage(prompt);
    return Response.json({ base64, mimeType });
  } catch (err) {
    const message = err instanceof Error ? err.message : "generation failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
