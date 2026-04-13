export const dynamic = "force-dynamic";

import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";

// GET /api/scheduled?sessionId=X&chatJid=Y
// Returns scheduled messages without media_base64 (too large for list views).
export async function GET(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  const chatJid = url.searchParams.get("chatJid");

  const supabase = getSupabaseServer();
  let query = supabase
    .from("waclaw_scheduled_messages")
    .select("id, text, scheduled_for, status, error, sent_at, media_filename, media_mime_type")
    .eq("user_id", user.id)
    .order("scheduled_for", { ascending: true });

  if (sessionId) query = query.eq("waclaw_session_id", sessionId);
  if (chatJid) query = query.eq("chat_jid", chatJid);

  const { data, error } = await query.limit(200);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ messages: data });
}

// POST /api/scheduled
// body: { sessionId, chatJid, chatName?, text?, scheduledFor, mediaBase64?, mediaFilename?, mediaMimeType? }
// Either text or mediaBase64 (or both) must be provided.
export async function POST(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { sessionId, chatJid, chatName, text, scheduledFor, mediaBase64, mediaFilename, mediaMimeType } = body;

  if (!sessionId || !chatJid || !scheduledFor) {
    return Response.json({ error: "sessionId, chatJid, scheduledFor required" }, { status: 400 });
  }

  const hasText = typeof text === "string" && text.trim().length > 0;
  const hasMedia = typeof mediaBase64 === "string" && mediaBase64.length > 0;
  if (!hasText && !hasMedia) {
    return Response.json({ error: "text or media attachment required" }, { status: 400 });
  }

  const when = new Date(scheduledFor);
  if (isNaN(when.getTime())) {
    return Response.json({ error: "invalid scheduledFor" }, { status: 400 });
  }
  if (when.getTime() < Date.now() - 60_000) {
    return Response.json({ error: "scheduledFor must be in the future" }, { status: 400 });
  }

  const supabase = getSupabaseServer();

  // Verify ownership of the session
  const { data: instance } = await supabase
    .from("instances")
    .select("id")
    .eq("user_id", user.id)
    .eq("waclaw_session_id", sessionId)
    .maybeSingle();
  if (!instance) {
    return Response.json({ error: "Session not accessible" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("waclaw_scheduled_messages")
    .insert({
      user_id: user.id,
      waclaw_session_id: sessionId,
      chat_jid: chatJid,
      chat_name: chatName || null,
      text: hasText ? text.trim() : null,
      scheduled_for: when.toISOString(),
      ...(hasMedia ? {
        media_base64: mediaBase64,
        media_filename: mediaFilename || "arquivo",
        media_mime_type: mediaMimeType || "application/octet-stream",
      } : {}),
    })
    .select("id, text, scheduled_for, status, error, sent_at, media_filename, media_mime_type")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data, { status: 201 });
}
