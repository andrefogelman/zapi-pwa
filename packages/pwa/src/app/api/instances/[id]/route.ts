export const dynamic = "force-dynamic";
import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";
import { env } from "@/lib/env";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabaseServer();

  // Fetch the instance and verify ownership before deleting anything
  const { data: instance, error: fetchErr } = await supabase
    .from("instances")
    .select("id, provider, waclaw_session_id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (fetchErr || !instance) {
    return Response.json({ error: "Instance not found" }, { status: 404 });
  }

  // Best-effort: remove the waclaw session on worker5 too. Don't block the
  // Supabase delete on network failures — the frontend can retry.
  if (instance.provider === "waclaw" && instance.waclaw_session_id) {
    try {
      await fetch(`${env.WACLAW_URL}/sessions/${instance.waclaw_session_id}`, {
        method: "DELETE",
        headers: { "X-API-Key": env.WACLAW_API_KEY },
      });
    } catch (err) {
      console.error("Failed to delete waclaw session:", err);
    }
  }

  const { error: delErr } = await supabase
    .from("instances")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (delErr) return Response.json({ error: delErr.message }, { status: 500 });
  return Response.json({ ok: true });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const updates: Record<string, unknown> = {};
  if (typeof body?.name === "string") updates.name = body.name;
  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "No updatable fields" }, { status: 400 });
  }

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("instances")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}
