export const dynamic = "force-dynamic";

import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";

async function auth(request: Request) {
  const token = request.headers.get("Authorization")?.replace(/^[Bb]earer\s+/, "");
  if (!token) return null;
  return getUserFromToken(token);
}

export async function GET(request: Request) {
  const user = await auth(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("user_settings")
    .select("display_name, transcription_footer, role")
    .eq("user_id", user.id)
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

export async function PATCH(request: Request) {
  const user = await auth(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json();
  const updates: Record<string, unknown> = {};
  if (typeof body.display_name === "string") updates.display_name = body.display_name;
  if (typeof body.transcription_footer === "string") {
    updates.transcription_footer = body.transcription_footer;
  }
  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "no valid fields" }, { status: 400 });
  }
  updates.updated_at = new Date().toISOString();

  const supabase = getSupabaseServer();
  const { error } = await supabase
    .from("user_settings")
    .update(updates)
    .eq("user_id", user.id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
