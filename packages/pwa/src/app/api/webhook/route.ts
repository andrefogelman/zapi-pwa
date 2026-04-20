export const dynamic = "force-dynamic";
import { getSupabaseServer } from "@/lib/supabase-server";
import { TranscriptionQueue } from "@/lib/queue";
import { env } from "@/lib/env";
import { z } from "zod";
import { createHmac, timingSafeEqual } from "crypto";

// Z-API webhook payload schema. We validate the minimum we need — unknown
// fields are ignored silently to stay compatible with provider changes.
const WebhookSchema = z.object({
  instanceId: z.string().min(1).max(128),
  messageId: z.string().max(256).optional(),
  phone: z.string().max(64).optional(),
  fromMe: z.boolean().optional(),
  senderName: z.string().max(256).optional(),
  chatName: z.string().max(256).optional(),
  isGroup: z.boolean().optional(),
  momment: z.union([z.number(), z.string()]).optional(),
  text: z.object({ message: z.string().max(64_000).optional() }).optional(),
  audio: z.object({ audioUrl: z.string().url().max(2048).optional() }).optional(),
  image: z.object({
    imageUrl: z.string().url().max(2048).optional(),
    caption: z.string().max(16_000).optional(),
  }).optional(),
  video: z.object({
    videoUrl: z.string().url().max(2048).optional(),
    caption: z.string().max(16_000).optional(),
  }).optional(),
  document: z.object({
    documentUrl: z.string().url().max(2048).optional(),
    caption: z.string().max(16_000).optional(),
  }).optional(),
});

// Constant-time HMAC comparison. Returns false on any mismatch.
function verifySignature(rawBody: string, headerSig: string | null): boolean {
  const secret = env.ZAPI_WEBHOOK_SECRET;
  if (!secret) return false;
  if (!headerSig) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const received = headerSig.replace(/^sha256=/i, "").trim();
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(received, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const headerSig = request.headers.get("x-zapi-signature") ?? request.headers.get("x-hub-signature-256");
  // Secret is optional for local dev; in production set ZAPI_WEBHOOK_SECRET and
  // every inbound request must match the HMAC.
  if (env.ZAPI_WEBHOOK_SECRET && !verifySignature(rawBody, headerSig)) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  let parsed: z.infer<typeof WebhookSchema>;
  try {
    parsed = WebhookSchema.parse(JSON.parse(rawBody));
  } catch {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }

  const {
    instanceId, messageId, phone, fromMe,
    text, audio, image, video, document: doc,
    senderName, chatName, isGroup, momment,
  } = parsed;

  const supabase = getSupabaseServer();

  const { data: instance } = await supabase
    .from("instances")
    .select("id")
    .eq("zapi_instance_id", instanceId)
    .single();

  if (!instance) {
    // 404 tells the provider to stop retrying; hides that we only know some IDs.
    return Response.json({ error: "unknown instance" }, { status: 404 });
  }

  let msgType = "text";
  let msgText: string | null = null;
  let mediaUrl: string | null = null;

  if (audio) {
    msgType = "audio";
    mediaUrl = audio.audioUrl ?? null;
  } else if (image) {
    msgType = "image";
    msgText = image.caption ?? null;
    mediaUrl = image.imageUrl ?? null;
  } else if (video) {
    msgType = "video";
    msgText = video.caption ?? null;
    mediaUrl = video.videoUrl ?? null;
  } else if (doc) {
    msgType = "document";
    msgText = doc.caption ?? null;
    mediaUrl = doc.documentUrl ?? null;
  } else if (text) {
    msgText = text.message ?? null;
  }

  const chatJid = phone ?? "unknown";
  void isGroup; // reserved for group-specific routing later

  const { data, error } = await supabase.from("messages").insert({
    instance_id: instance.id,
    message_id: messageId ?? crypto.randomUUID(),
    chat_jid: chatJid,
    sender: fromMe ? "me" : (senderName ?? chatName ?? phone ?? "unknown"),
    text: msgText,
    type: msgType,
    from_me: fromMe ?? false,
    media_url: mediaUrl,
    status: msgType === "audio" ? "pending_transcription" : "received",
    timestamp: momment ? new Date(momment).toISOString() : new Date().toISOString(),
  }).select("id").single();

  if (error) {
    // Log server-side only; never return raw DB errors to the webhook caller.
    console.error("webhook message insert failed", { code: error.code, msg: error.message });
    return Response.json({ error: "persist failed" }, { status: 500 });
  }

  if (msgType === "audio" && mediaUrl && data) {
    await TranscriptionQueue.enqueue({
      instanceId: instance.id,
      messageId: data.id,
      audioUrl: mediaUrl,
    });
  }

  return Response.json({ received: true });
}
