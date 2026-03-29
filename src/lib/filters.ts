import { getZapiConfig } from "./config";
import { getGroupAuth } from "./supabase-server";

export interface ZapiBody {
  fromMe: boolean;
  phone: string;
  chatLid?: string;
  connectedPhone: string;
  instanceId: string;
  isGroup: boolean;
  chatName: string;
  messageId: string;
  senderName?: string;
  participantPhone?: string;
  text?: { message?: string };
  audio?: {
    audioUrl: string;
    seconds: number;
  };
}

// Z-API sends fields at root level (no wrapper), but n8n wrapped them in "body"
export type ZapiPayload = ZapiBody | { body: ZapiBody };

export type FilterResult =
  | { action: "skip"; reason: string }
  | { action: "process"; audioUrl: string; seconds: number; phoneOrLid: string };

function extractBody(payload: ZapiPayload): ZapiBody {
  if ("body" in payload && typeof payload.body === "object" && payload.body !== null && "phone" in payload.body) {
    return payload.body as ZapiBody;
  }
  return payload as ZapiBody;
}

function normalizeGroupId(phone: string): string {
  if (phone.endsWith("-group")) return phone.replace("-group", "@g.us");
  if (!phone.includes("@")) return `${phone}@g.us`;
  return phone;
}

export async function filterMessage(payload: ZapiPayload): Promise<FilterResult> {
  const config = await getZapiConfig();
  const body = extractBody(payload);
  const phone = body.phone ?? "";
  const chatLid = body.chatLid ?? "";

  // 1. To me? — ignore messages sent to self
  if (phone === config.connected_phone || chatLid === config.connected_phone) {
    return { action: "skip", reason: "message to self" };
  }

  // 2. Has audio?
  if (!body.audio?.audioUrl) {
    return { action: "skip", reason: "no audio" };
  }

  const phoneOrLid = chatLid || phone;

  // 3. Group message
  if (body.isGroup) {
    // Always transcribe own audio in any group
    if (body.fromMe) {
      return { action: "process", audioUrl: body.audio.audioUrl, seconds: body.audio.seconds, phoneOrLid };
    }

    // Check group authorization and settings
    const groupAuth = await getGroupAuth(normalizeGroupId(phone));
    if (!groupAuth.authorized) {
      return { action: "skip", reason: `group not authorized: ${phone}` };
    }

    // transcribe_all = true: transcribe ALL voice messages in this group (not just mine)
    if (groupAuth.transcribe_all) {
      return { action: "process", audioUrl: body.audio.audioUrl, seconds: body.audio.seconds, phoneOrLid };
    }

    // Default: only transcribe own audio (fromMe was already handled above)
    return { action: "skip", reason: "group audio from others (transcribe_all disabled)" };
  }

  // 4. DM — skip own numbers
  if (config.my_phones.includes(phone) || config.my_lids.includes(chatLid)) {
    return { action: "skip", reason: "own number DM" };
  }

  return { action: "process", audioUrl: body.audio.audioUrl, seconds: body.audio.seconds, phoneOrLid };
}
