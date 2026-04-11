export const dynamic = "force-dynamic";

import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";

// GET /api/starred?sessionId=X
// Returns: { starred: string[] } — array of starred waclaw msg_ids for this session
export async function GET(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("starred_messages")
    .select("waclaw_msg_id")
    .eq("user_id", user.id)
    .eq("waclaw_session_id", sessionId);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ starred: (data || []).map((r) => r.waclaw_msg_id) });
}

// POST /api/starred
// body: { sessionId, msgId, chatJid, starred }
// Upsert or delete the star record.
export async function POST(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { sessionId, msgId, chatJid, starred } = await request.json();
  if (!sessionId || !msgId || !chatJid || typeof starred !== "boolean") {
    return Response.json(
      { error: "sessionId, msgId, chatJid, starred required" },
      { status: 400 }
    );
  }

  const supabase = getSupabaseServer();

  if (starred) {
    const { error } = await supabase.from("starred_messages").upsert({
      user_id: user.id,
      waclaw_session_id: sessionId,
      waclaw_msg_id: msgId,
      chat_jid: chatJid,
    });
    if (error) return Response.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabase
      .from("starred_messages")
      .delete()
      .eq("user_id", user.id)
      .eq("waclaw_session_id", sessionId)
      .eq("waclaw_msg_id", msgId);
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
