import { getSupabaseServer } from "@/lib/supabase-server";
import { TranscriptionQueue } from "@/lib/queue";

export async function POST(request: Request) {
  const body = await request.json();

  // Z-API sends different event types
  const { phone, event, messageId, chatId, text, type, fromMe, audio, instanceId } = body;

  if (!instanceId) {
    return Response.json({ error: "Missing instanceId" }, { status: 400 });
  }

  const supabase = getSupabaseServer();

  // Look up internal instance by zapi_instance_id
  const { data: instance } = await supabase
    .from("instances")
    .select("id")
    .eq("zapi_instance_id", instanceId)
    .single();

  if (!instance) {
    return Response.json({ error: "Unknown instance" }, { status: 404 });
  }

  // Handle incoming message
  if (event === "message" || event === "message-status-update" || !event) {
    const { data, error } = await supabase.from("messages").insert({
      instance_id: instance.id,
      message_id: messageId || crypto.randomUUID(),
      chat_jid: chatId || phone || "unknown",
      sender: fromMe ? "me" : (phone || "unknown"),
      text: text || null,
      type: type || "text",
      from_me: fromMe || false,
      media_url: audio?.audioUrl || body.image?.imageUrl || body.video?.videoUrl || null,
      status: type === "audio" ? "pending_transcription" : "received",
    }).select("id").single();

    if (error) {
      console.error("Failed to save message:", error.message);
    }

    // Queue audio for transcription
    if ((type === "audio" || audio) && !error && data) {
      const audioUrl = audio?.audioUrl;
      if (audioUrl) {
        await TranscriptionQueue.enqueue({
          instanceId: instance.id,
          messageId: data.id,
          audioUrl,
        });
      }
    }
  }

  return Response.json({ received: true });
}
