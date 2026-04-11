export const dynamic = "force-dynamic";

import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";

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
  return data ? { user, supabase } : null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authAndOwn(request, id);
  if (!auth) return Response.json({ error: "forbidden" }, { status: 403 });

  const { data, error } = await auth.supabase
    .from("instance_groups")
    .select("*")
    .eq("instance_id", id)
    .order("subject");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ groups: data });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authAndOwn(request, id);
  if (!auth) return Response.json({ error: "forbidden" }, { status: 403 });

  const body = await request.json();
  if (typeof body.group_id !== "string" || typeof body.subject !== "string") {
    return Response.json({ error: "group_id and subject required" }, { status: 400 });
  }

  const row = {
    instance_id: id,
    group_id: body.group_id,
    subject: body.subject,
    subject_owner: body.subject_owner ?? null,
    group_lid: body.group_lid ?? null,
    transcribe_all: body.transcribe_all ?? false,
    send_reply: body.send_reply ?? true,
    monitor_daily: body.monitor_daily ?? false,
  };

  const { error } = await auth.supabase
    .from("instance_groups")
    .upsert(row, { onConflict: "instance_id,group_id" });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
