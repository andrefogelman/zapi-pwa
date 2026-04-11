import type { OnAudioEvent } from "zapi-shared";

export interface FilterInstance {
  my_phones: string[];
  my_lids: string[];
  connected_phone: string | null;
}

export interface FilterGroup {
  transcribe_all: boolean;
  send_reply: boolean;
}

export type FilterDecision =
  | { action: "skip"; reason: string }
  | { action: "process"; sendReply: boolean };

/**
 * Decides whether an incoming audio event should be transcribed
 * and whether the transcription should be sent back to WhatsApp.
 *
 * Rules:
 * - Echo prevention: messages from the instance's own numbers → skip.
 * - DMs (not group): always process, always send reply.
 * - Groups not in authorized list → skip.
 * - Group authorized, from_me=true → process, reply per group setting.
 * - Group authorized, transcribe_all=false, not from_me → skip.
 * - Group authorized, transcribe_all=true → process, reply per group setting.
 */
export function filterMessage(input: {
  event: OnAudioEvent;
  instance: FilterInstance;
  group: FilterGroup | null;
}): FilterDecision {
  const { event, instance, group } = input;

  // Echo prevention. Three cases:
  //   - sender matches this instance's connected phone
  //   - sender's phone is in the user's list of own numbers
  //   - chat_jid matches a known own LID (covers LID-based DMs to ourselves,
  //     where waclaw returns the LID string as chat_jid — e.g. "249520...@lid".
  //     For group chats chat_jid ends with "@g.us", so this never matches a
  //     legitimate group even if my_lids contains unrelated LID strings.)
  if (
    event.sender_phone === instance.connected_phone ||
    instance.my_phones.includes(event.sender_phone) ||
    instance.my_lids.includes(event.chat_jid)
  ) {
    return { action: "skip", reason: "self" };
  }

  // DMs: always process, always reply
  if (!event.is_group) {
    return { action: "process", sendReply: true };
  }

  // Groups: must be authorized
  if (!group) {
    return { action: "skip", reason: "group not authorized" };
  }

  // Own audio in authorized group: always process
  if (event.from_me) {
    return { action: "process", sendReply: group.send_reply };
  }

  // Others' audio: only if transcribe_all
  if (!group.transcribe_all) {
    return { action: "skip", reason: "transcribe_all disabled" };
  }

  return { action: "process", sendReply: group.send_reply };
}
