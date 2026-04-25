import type { OnAudioEvent } from "zapi-shared";

export interface FilterInstance {
  my_phones: string[];
  my_lids: string[];
  connected_phone: string | null;
  connected_lid: string | null;
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

  // Echo prevention. Cases:
  //   - sender_phone matches connected_phone or a known own phone
  //   - sender_lid (when present) matches connected_lid or a known own LID
  //   - chat_jid matches a known own LID (LID-based DMs to ourselves)
  //   - chat_lid (when present) matches a known own LID
  //
  // Group chats never match my_lids via chat_jid because their JID ends in
  // "@g.us", so stray my_lids entries are harmless. For LID-addressed groups
  // we still rely on sender_lid/from_me.
  const ownLidMatchSender = event.sender_lid ? (
    event.sender_lid === instance.connected_lid ||
    instance.my_lids.includes(event.sender_lid)
  ) : false;
  const ownLidMatchChat = instance.my_lids.includes(event.chat_jid) ||
    (event.chat_lid ? instance.my_lids.includes(event.chat_lid) : false);
  if (
    event.sender_phone === instance.connected_phone ||
    instance.my_phones.includes(event.sender_phone) ||
    ownLidMatchSender ||
    ownLidMatchChat
  ) {
    return { action: "skip", reason: "self" };
  }

  // DMs: always process, always reply
  if (!event.is_group) {
    return { action: "process", sendReply: true };
  }

  // Own audio in any group: always process and reply so the sender gets the
  // transcription regardless of whether the group is authorized.
  if (event.from_me) {
    return { action: "process", sendReply: group?.send_reply ?? true };
  }

  // Others' audio in unauthorized groups: skip
  if (!group) {
    return { action: "skip", reason: "group not authorized" };
  }

  // Others' audio: only if transcribe_all
  if (!group.transcribe_all) {
    return { action: "skip", reason: "transcribe_all disabled" };
  }

  return { action: "process", sendReply: group.send_reply };
}
