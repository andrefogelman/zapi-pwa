export const dynamic = "force-dynamic";

import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";
import { transcribeAudio } from "@/lib/openai";

// POST /api/transcribe-raw
// Content-Type: multipart/form-data with:
//   - audio (File, required)
//   - sessionId (string, optional) — if present together with msgId, the
//     transcription is persisted to waclaw_transcriptions so other
//     devices / later reloads see it.
//   - msgId (string, optional)
//
// Used for locally-sent voice messages where the client has the audio bytes
// in hand already and the real waclaw msgId only comes back from /send-file
// (the /api/transcribe endpoint requires msgId to refetch bytes from waclaw).
export async function POST(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("audio");
  if (!(file instanceof File)) {
    return Response.json({ error: "audio field required" }, { status: 400 });
  }
  const sessionId = form.get("sessionId");
  const msgId = form.get("msgId");

  const buffer = await file.arrayBuffer();
  if (buffer.byteLength === 0) {
    return Response.json({ error: "Empty audio" }, { status: 400 });
  }
  // Cap at 25 MB (Whisper API limit)
  if (buffer.byteLength > 25 * 1024 * 1024) {
    return Response.json({ error: "Audio too large (max 25 MB)" }, { status: 413 });
  }

  let text: string;
  try {
    text = await transcribeAudio(buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcription failed";
    return Response.json({ error: message }, { status: 500 });
  }

  // Persist if the caller gave us the real waclaw message id. Verify
  // session ownership before upserting so this endpoint can't be used to
  // stuff transcriptions into sessions the user doesn't own.
  if (typeof sessionId === "string" && sessionId && typeof msgId === "string" && msgId) {
    const supabase = getSupabaseServer();
    const { data: instance } = await supabase
      .from("instances")
      .select("id")
      .eq("user_id", user.id)
      .eq("waclaw_session_id", sessionId)
      .maybeSingle();
    if (instance) {
      await supabase
        .from("waclaw_transcriptions")
        .upsert({
          waclaw_session_id: sessionId,
          waclaw_msg_id: msgId,
          text,
        });
    }
  }

  return Response.json({ text });
}
