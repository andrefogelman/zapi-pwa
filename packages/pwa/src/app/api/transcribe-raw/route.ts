export const dynamic = "force-dynamic";

import { getUserFromToken } from "@/lib/supabase-server";
import { transcribeAudio } from "@/lib/openai";

// POST /api/transcribe-raw
// Content-Type: multipart/form-data with "audio" field.
// Used for locally-sent voice messages where the client has the audio bytes
// in hand but no waclaw msgId yet (the /api/transcribe endpoint requires
// msgId to fetch bytes from waclaw).
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

  const buffer = await file.arrayBuffer();
  if (buffer.byteLength === 0) {
    return Response.json({ error: "Empty audio" }, { status: 400 });
  }
  // Cap at 25 MB (Whisper API limit) to avoid surprises
  if (buffer.byteLength > 25 * 1024 * 1024) {
    return Response.json({ error: "Audio too large (max 25 MB)" }, { status: 413 });
  }

  try {
    const text = await transcribeAudio(buffer);
    return Response.json({ text });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcription failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
