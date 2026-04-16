export const dynamic = "force-dynamic";

import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";

// POST /api/tasks/[id]/participants
// body: { user_id?, contact_jid?, instance_id?, role? }
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const supabase = getSupabaseServer();

  const { data, error } = await supabase
    .from("task_participants")
    .insert({
      task_id: id,
      user_id: body.user_id || null,
      contact_jid: body.contact_jid || null,
      instance_id: body.instance_id || null,
      role: body.role || "participant",
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ participant: data }, { status: 201 });
}

// DELETE /api/tasks/[id]/participants?participantId=X
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const url = new URL(request.url);
  const participantId = url.searchParams.get("participantId");
  if (!participantId) {
    return Response.json({ error: "participantId required" }, { status: 400 });
  }

  const supabase = getSupabaseServer();
  const { error } = await supabase
    .from("task_participants")
    .delete()
    .eq("id", participantId)
    .eq("task_id", id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
