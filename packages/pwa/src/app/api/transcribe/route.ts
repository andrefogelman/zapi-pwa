export const dynamic = "force-dynamic";

import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";
import { transcribeAudio } from "@/lib/openai";
import { env } from "@/lib/env";

// POST /api/transcribe
// body: { sessionId, msgId, chatJid }
// Returns: { text, cached }
export async function POST(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { sessionId, msgId, chatJid } = await request.json();
  if (!sessionId || !msgId || !chatJid) {
    return Response.json(
      { error: "sessionId, msgId, and chatJid required" },
      { status: 400 }
    );
  }

  const supabase = getSupabaseServer();

  // Verify the user owns an instance bound to this session
  const { data: instance } = await supabase
    .from("instances")
    .select("id")
    .eq("user_id", user.id)
    .eq("waclaw_session_id", sessionId)
    .maybeSingle();
  if (!instance) {
    return Response.json({ error: "Session not accessible" }, { status: 403 });
  }

  // Cache hit?
  const { data: cached } = await supabase
    .from("waclaw_transcriptions")
    .select("text")
    .eq("waclaw_session_id", sessionId)
    .eq("waclaw_msg_id", msgId)
    .maybeSingle();
  if (cached?.text) {
    return Response.json({ text: cached.text, cached: true });
  }

  // Fetch audio bytes from waclaw (on-demand download handled by waclaw)
  const mediaUrl = `${env.WACLAW_URL}/sessions/${sessionId}/media/${encodeURIComponent(chatJid)}/${encodeURIComponent(msgId)}`;
  const mediaRes = await fetch(mediaUrl, {
    headers: { "X-API-Key": env.WACLAW_API_KEY },
  });
  if (!mediaRes.ok) {
    return Response.json(
      { error: `Failed to fetch audio: HTTP ${mediaRes.status}` },
      { status: 502 }
    );
  }
  const audioBuffer = await mediaRes.arrayBuffer();
  if (audioBuffer.byteLength === 0) {
    return Response.json({ error: "Empty audio" }, { status: 502 });
  }

  // Call Whisper
  let text: string;
  try {
    text = await transcribeAudio(audioBuffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcription failed";
    return Response.json({ error: message }, { status: 500 });
  }

  // Cache. Use service-role client so RLS-allowed upsert works even if
  // instances query above is stale.
  await supabase.from("waclaw_transcriptions").upsert({
    waclaw_session_id: sessionId,
    waclaw_msg_id: msgId,
    text,
  });

  return Response.json({ text, cached: false });
}

// GET /api/transcribe?sessionId=X — returns all cached transcriptions for the
// session as a map { msgId: text }, so useMessages can bulk-hydrate on load.
export async function GET(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });

  const supabase = getSupabaseServer();
  const { data: instance } = await supabase
    .from("instances")
    .select("id")
    .eq("user_id", user.id)
    .eq("waclaw_session_id", sessionId)
    .maybeSingle();
  if (!instance) return Response.json({ error: "Session not accessible" }, { status: 403 });

  const { data } = await supabase
    .from("waclaw_transcriptions")
    .select("waclaw_msg_id, text")
    .eq("waclaw_session_id", sessionId);

  const map: Record<string, string> = {};
  for (const row of data || []) {
    map[row.waclaw_msg_id] = row.text;
  }
  return Response.json({ transcriptions: map });
}
