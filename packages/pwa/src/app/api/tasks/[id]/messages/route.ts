export const dynamic = "force-dynamic";

import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";

// POST /api/tasks/[id]/messages
// body: { instance_id, chat_jid, waclaw_msg_id, waclaw_session_id, snippet?, sender_name?, message_ts? }
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

  if (!body.instance_id || !body.chat_jid || !body.waclaw_msg_id || !body.waclaw_session_id) {
    return Response.json(
      { error: "instance_id, chat_jid, waclaw_msg_id, waclaw_session_id required" },
      { status: 400 }
    );
  }

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("task_messages")
    .insert({
      task_id: id,
      instance_id: body.instance_id,
      chat_jid: body.chat_jid,
      waclaw_msg_id: body.waclaw_msg_id,
      waclaw_session_id: body.waclaw_session_id,
      snippet: body.snippet || null,
      sender_name: body.sender_name || null,
      message_ts: body.message_ts || null,
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ message: data }, { status: 201 });
}

// DELETE /api/tasks/[id]/messages?messageId=X
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
  const messageId = url.searchParams.get("messageId");
  if (!messageId) {
    return Response.json({ error: "messageId required" }, { status: 400 });
  }

  const supabase = getSupabaseServer();
  const { error } = await supabase
    .from("task_messages")
    .delete()
    .eq("id", messageId)
    .eq("task_id", id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
