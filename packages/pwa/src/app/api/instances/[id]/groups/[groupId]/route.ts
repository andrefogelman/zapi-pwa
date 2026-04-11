export const dynamic = "force-dynamic";

import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";

type Params = Promise<{ id: string; groupId: string }>;

async function authAndOwn(request: Request, instanceId: string) {
  const token = request.headers.get("Authorization")?.replace(/^[Bb]earer\s+/, "");
  if (!token) return null;
  const user = await getUserFromToken(token);
  if (!user) return null;
  const supabase = getSupabaseServer();
  const { data } = await supabase
    .from("instances")
    .select("id")
    .eq("id", instanceId)
    .eq("user_id", user.id)
    .maybeSingle();
  return data ? { supabase } : null;
}

export async function PATCH(request: Request, { params }: { params: Params }) {
  const { id, groupId } = await params;
  const auth = await authAndOwn(request, id);
  if (!auth) return Response.json({ error: "forbidden" }, { status: 403 });

  const body = await request.json();
  const updates: Record<string, unknown> = {};
  if (typeof body.transcribe_all === "boolean") updates.transcribe_all = body.transcribe_all;
  if (typeof body.send_reply === "boolean") updates.send_reply = body.send_reply;
  if (typeof body.monitor_daily === "boolean") updates.monitor_daily = body.monitor_daily;
  if (typeof body.subject === "string") updates.subject = body.subject;

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "no valid fields" }, { status: 400 });
  }

  const { error } = await auth.supabase
    .from("instance_groups")
    .update(updates)
    .eq("instance_id", id)
    .eq("group_id", groupId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

export async function DELETE(request: Request, { params }: { params: Params }) {
  const { id, groupId } = await params;
  const auth = await authAndOwn(request, id);
  if (!auth) return Response.json({ error: "forbidden" }, { status: 403 });

  const { error } = await auth.supabase
    .from("instance_groups")
    .delete()
    .eq("instance_id", id)
    .eq("group_id", groupId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
