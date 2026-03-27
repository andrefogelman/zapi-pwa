import { getZapiConfig } from "./config";
import { isGroupAuthorized } from "./supabase-server";

export interface ZapiPayload {
  body: {
    fromMe: boolean;
    phone: string;
    chatLid?: string;
    connectedPhone: string;
    instanceId: string;
    isGroup: boolean;
    chatName: string;
    messageId: string;
    audio?: {
      audioUrl: string;
      seconds: number;
    };
  };
}

export type FilterResult =
  | { action: "skip"; reason: string }
  | { action: "process"; audioUrl: string; seconds: number; phoneOrLid: string };

export async function filterMessage(payload: ZapiPayload): Promise<FilterResult> {
  const config = await getZapiConfig();
  const { body } = payload;
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
    if (body.fromMe) {
      return { action: "process", audioUrl: body.audio.audioUrl, seconds: body.audio.seconds, phoneOrLid };
    }
    // Check if group is authorized (by group_id = phone)
    const authorized = await isGroupAuthorized(phone);
    if (!authorized) {
      return { action: "skip", reason: `group not authorized: ${phone}` };
    }
    return { action: "process", audioUrl: body.audio.audioUrl, seconds: body.audio.seconds, phoneOrLid };
  }

  // 4. DM — skip own numbers
  if (config.my_phones.includes(phone) || config.my_lids.includes(chatLid)) {
    return { action: "skip", reason: "own number DM" };
  }

  return { action: "process", audioUrl: body.audio.audioUrl, seconds: body.audio.seconds, phoneOrLid };
}
