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
  const timeout = setTimeout(() => controller.abort(), 25000); // 25s timeout
  try {
    const res = await fetch(`${env.WACLI_API_URL}${path}`, {
      headers: { Authorization: `Bearer ${env.WACLI_API_TOKEN}` },
      signal: controller.signal,
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
