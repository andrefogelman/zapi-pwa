import { env } from "./env";

interface WacliMessage {
  sender: string;
  timestamp: string;
  text: string;
  type: string;
  fromMe: boolean;
  chatName: string;
}

interface WacliChat {
  jid: string;
  name: string;
  isGroup: boolean;
}

async function wacliRequest<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50000); // 50s timeout for batch ops
  try {
    const res = await fetch(`${env.WACLI_API_URL}${path}`, {
      headers: { Authorization: `Bearer ${env.WACLI_API_TOKEN}` },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`wacli-api ${res.status}: ${body}`);
    }
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchMessages(params: {
  chat: string;
  after?: string;
  before?: string;
  query?: string;
  limit?: number;
}): Promise<{ messages: WacliMessage[]; total: number }> {
  const qs = new URLSearchParams({ chat: params.chat });
  if (params.after) qs.set("after", params.after);
  if (params.before) qs.set("before", params.before);
  if (params.query) qs.set("query", params.query);
  if (params.limit) qs.set("limit", String(params.limit));
  return wacliRequest(`/messages?${qs}`);
}

export async function fetchChats(query?: string, limit?: number): Promise<{ chats: WacliChat[] }> {
  const qs = new URLSearchParams();
  if (query) qs.set("query", query);
  if (limit) qs.set("limit", String(limit));
  return wacliRequest(`/chats?${qs}`);
}

interface LastMessageInfo {
  text: string;
  sender: string;
  fromMe: boolean;
  timestamp: string;
  type: string;
}

export async function fetchLastMessages(chatJids: string[]): Promise<Record<string, LastMessageInfo>> {
  if (chatJids.length === 0) return {};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50000);
  try {
    const res = await fetch(`${env.WACLI_API_URL}/last-messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.WACLI_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ chats: chatJids }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`wacli-api ${res.status}`);
    const data = await res.json();
    return data.lastMessages;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchContactNames(jids: string[]): Promise<Record<string, string>> {
  if (jids.length === 0) return {};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${env.WACLI_API_URL}/contacts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.WACLI_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ jids }),
      signal: controller.signal,
    });
    if (!res.ok) return {};
    const data = await res.json();
    return data.contacts || {};
  } catch { return {}; }
  finally { clearTimeout(timeout); }
}

export async function fetchPhotos(phones: string[]): Promise<Record<string, string>> {
  if (phones.length === 0) return {};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50000);
  try {
    const res = await fetch(`${env.WACLI_API_URL}/photos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.WACLI_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ phones }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`wacli-api ${res.status}`);
    const data = await res.json();
    return data.photos;
  } finally {
    clearTimeout(timeout);
  }
}
