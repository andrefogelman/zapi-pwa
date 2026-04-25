export const dynamic = "force-dynamic";
export const maxDuration = 60;

import {
  OnAudioEventSchema,
  INTERNAL_HEADER_SECRET,
  type OnAudioResponse,
} from "zapi-shared";
import { getSupabaseServiceRole } from "@/lib/supabase-server";
import { filterMessage } from "@/lib/filter";
import { transcribeAudio } from "@/lib/openai";
import { formatReply } from "@/lib/footer";
import { env } from "@/lib/env";

export async function POST(req: Request): Promise<Response> {
  // 1. Shared-secret auth — daemon has no user identity, so we trust a
  // pre-shared secret in a custom header. Must match the env var set on
  // both Vercel and the daemon's .env.
  if (req.headers.get(INTERNAL_HEADER_SECRET) !== process.env.INTERNAL_WEBHOOK_SECRET) {
    return Response.json(
      { status: "failed", reason: "unauthorized" } satisfies OnAudioResponse,
      { status: 401 }
    );
  }

  // 2. Schema validation — if the daemon sends a malformed event,
  // return 400 so the daemon logs it and doesn't retry forever.
  const parsed = OnAudioEventSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json(
      { status: "failed", reason: "invalid payload" } satisfies OnAudioResponse,
      { status: 400 }
    );
  }
  const event = parsed.data;
  const supabase = getSupabaseServiceRole();

  // 3. Look up the instance by waclaw_session_id. Skip if unknown
  // (can happen briefly after a session is created but before the
  // first message arrives).
  const { data: instance } = await supabase
    .from("instances")
    .select("id, user_id, my_phones, my_lids, connected_phone, connected_lid")
    .eq("waclaw_session_id", event.waclaw_session_id)
    .maybeSingle();
  if (!instance) {
    return Response.json({
      status: "skipped",
      reason: "session not bound",
    } satisfies OnAudioResponse);
  }

  // 4. Idempotency — if we already stored this message_id for this
  // instance, don't reprocess.
  const { data: existing } = await supabase
    .from("messages")
    .select("id")
    .eq("instance_id", instance.id)
    .eq("message_id", event.message_id)
    .maybeSingle();
  if (existing) {
    return Response.json({
      status: "skipped",
      reason: "duplicate",
    } satisfies OnAudioResponse);
  }

  // 5. Fetch group (if applicable) + platform config + user footer, in parallel.
  const [groupsRes, configRes, userSettingsRes] = await Promise.all([
    event.is_group
      ? supabase
          .from("instance_groups")
          .select("transcribe_all, send_reply")
          .eq("instance_id", instance.id)
          .eq("group_id", event.chat_jid)
      : Promise.resolve({
          data: [] as Array<{ transcribe_all: boolean; send_reply: boolean }>,
        }),
    supabase.from("platform_config").select("*").eq("id", 1).single(),
    supabase
      .from("user_settings")
      .select("transcription_footer")
      .eq("user_id", instance.user_id)
      .single(),
  ]);

  const groups = groupsRes.data ?? [];
  const config = configRes.data;
  const userSettings = userSettingsRes.data;

  // 6. Filter decision (pure function, already tested)
  const decision = filterMessage({
    event,
    instance: {
      my_phones: instance.my_phones ?? [],
      my_lids: instance.my_lids ?? [],
      connected_phone: instance.connected_phone,
      connected_lid: instance.connected_lid ?? null,
    },
    group: groups[0] ?? null,
  });

  if (decision.action === "skip") {
    // Still store the message so the chat UI shows the audio bubble.
    await supabase.from("messages").insert({
      instance_id: instance.id,
      message_id: event.message_id,
      chat_jid: event.chat_jid,
      sender: event.sender_name ?? event.sender_phone,
      type: "audio",
      from_me: event.from_me,
      media_url: event.audio_url,
      status: "received",
      timestamp: event.timestamp,
    });
    return Response.json({
      status: "skipped",
      reason: decision.reason,
    } satisfies OnAudioResponse);
  }

  // 7. Run Whisper — use bytes pre-fetched by the daemon when available (the
  // daemon has direct Tailscale access; Vercel does not). Fall back to a URL
  // fetch only when bytes are absent (e.g. an old daemon build).
  let transcribedText: string;
  try {
    let audioBuffer: ArrayBuffer;
    if (event.audio_bytes_base64) {
      const nodeBuf = Buffer.from(event.audio_bytes_base64, "base64");
      // Buffer may share an underlying pool; slice to exact bounds so the File
      // sent to Whisper doesn't contain trailing zero-bytes from the pool.
      audioBuffer = nodeBuf.buffer.slice(
        nodeBuf.byteOffset,
        nodeBuf.byteOffset + nodeBuf.byteLength,
      ) as ArrayBuffer;
    } else {
      const resolvedAudioUrl = event.audio_url.replace(
        /^https?:\/\/localhost(:\d+)?/,
        env.WACLAW_URL.replace(/\/$/, ""),
      );
      const audioHeaders: Record<string, string> =
        resolvedAudioUrl !== event.audio_url
          ? { "X-API-Key": env.WACLAW_API_KEY }
          : {};
      const audioRes = await fetch(resolvedAudioUrl, { headers: audioHeaders });
      if (!audioRes.ok) {
        throw new Error(`audio download failed: ${audioRes.status} (url: ${resolvedAudioUrl})`);
      }
      audioBuffer = await audioRes.arrayBuffer();
    }
    transcribedText = await transcribeAudio(audioBuffer, {
      // neura_model is for the summarizer (gpt-4o); transcription always uses whisper-1
      prompt: config?.neura_prompt,
      temperature: config?.neura_temperature,
    });
  } catch (err) {
    // Mark the message as failed so the admin dashboard can surface it.
    await supabase.from("messages").insert({
      instance_id: instance.id,
      message_id: event.message_id,
      chat_jid: event.chat_jid,
      sender: event.sender_name ?? event.sender_phone,
      type: "audio",
      from_me: event.from_me,
      media_url: event.audio_url,
      status: "transcription_failed",
      timestamp: event.timestamp,
    });
    return Response.json(
      { status: "failed", reason: String(err) } satisfies OnAudioResponse,
      { status: 500 }
    );
  }

  // 8. Persist message + transcription
  const { data: messageRow, error: insertErr } = await supabase
    .from("messages")
    .insert({
      instance_id: instance.id,
      message_id: event.message_id,
      chat_jid: event.chat_jid,
      sender: event.sender_name ?? event.sender_phone,
      text: transcribedText,
      type: "audio",
      from_me: event.from_me,
      media_url: event.audio_url,
      status: "received",
      timestamp: event.timestamp,
    })
    .select("id")
    .single();

  if (insertErr || !messageRow) {
    return Response.json(
      {
        status: "failed",
        reason: `persist message: ${insertErr?.message ?? "no row returned"}`,
      } satisfies OnAudioResponse,
      { status: 500 }
    );
  }

  const { error: trInsertErr } = await supabase.from("transcriptions").insert({
    message_id: messageRow.id,
    instance_id: instance.id,
    text: transcribedText,
    duration_ms: event.audio_duration_seconds * 1000,
  });
  if (trInsertErr) {
    // Non-fatal: the text is already in messages.text and the chat UI will
    // still display it. We just lose the dedicated transcription row (used by
    // stats and future features). Log loudly so operators can reconcile.
    console.error("on-audio: transcriptions insert failed", {
      message_id: messageRow.id,
      instance_id: instance.id,
      err: trInsertErr,
    });
  }

  // 9. Build reply text and return it to the daemon. Vercel has no Tailscale
  // access so it cannot call waclaw-go directly; the daemon (on worker5)
  // picks up reply_text and sends it via localhost.
  const reply_text = decision.sendReply
    ? formatReply(transcribedText, userSettings?.transcription_footer ?? "Transcrição por IA 😜")
    : undefined;

  return Response.json({ status: "transcribed", reply_text } satisfies OnAudioResponse);
}
