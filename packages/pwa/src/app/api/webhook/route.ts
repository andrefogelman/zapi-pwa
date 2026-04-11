export const dynamic = "force-dynamic";
import { getSupabaseServer } from "@/lib/supabase-server";
import { TranscriptionQueue } from "@/lib/queue";

export async function POST(request: Request) {
  const body = await request.json();

  // Z-API webhook payload fields
  const {
    instanceId,
    messageId,
    phone,
    fromMe,
    text,
    audio,
    image,
    video,
    document: doc,
    senderName,
    chatName,
    isGroup,
  } = body;

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
    console.error(`Webhook: unknown instanceId ${instanceId}`);
    return Response.json({ received: true });
  }

  // Determine message type and content
  let msgType = "text";
  let msgText: string | null = null;
  let mediaUrl: string | null = null;

  if (audio) {
    msgType = "audio";
    mediaUrl = audio.audioUrl || null;
  } else if (image) {
    msgType = "image";
    msgText = image.caption || null;
    mediaUrl = image.imageUrl || null;
  } else if (video) {
    msgType = "video";
    msgText = video.caption || null;
    mediaUrl = video.videoUrl || null;
  } else if (doc) {
    msgType = "document";
    msgText = doc.caption || null;
    mediaUrl = doc.documentUrl || null;
  } else if (text) {
    msgText = text.message || null;
  }

  // Build chat JID
  const chatJid = isGroup
    ? (phone || "unknown")
    : (phone || "unknown");

  const { data, error } = await supabase.from("messages").insert({
    instance_id: instance.id,
    message_id: messageId || crypto.randomUUID(),
    chat_jid: chatJid,
    sender: fromMe ? "me" : (senderName || chatName || phone || "unknown"),
    text: msgText,
    type: msgType,
    from_me: fromMe || false,
    media_url: mediaUrl,
    status: msgType === "audio" ? "pending_transcription" : "received",
    timestamp: body.momment ? new Date(body.momment).toISOString() : new Date().toISOString(),
  }).select("id").single();

  if (error) {
    console.error("Failed to save message:", error.message);
  }

  // Queue audio for transcription
  if (msgType === "audio" && mediaUrl && !error && data) {
    await TranscriptionQueue.enqueue({
      instanceId: instance.id,
      messageId: data.id,
      audioUrl: mediaUrl,
    });
  }

  return Response.json({ received: true });
}
