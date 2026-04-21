export const dynamic = "force-dynamic";

import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";
import { env } from "@/lib/env";
import { z } from "zod";

interface GroupMessage {
  id: string;
  chatJid: string;
  senderName: string | null;
  senderJid: string | null;
  timestamp: number;
  fromMe: boolean;
  text: string | null;
  type: string;
  mediaCaption: string | null;
}

// GET /api/tasks/[id]/thread — merges WA group messages + internal comments
// into a single chronological list. Consumed by the task dashboard.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const supabase = getSupabaseServer();
  const { data: task } = await supabase
    .from("tasks")
    .select("wa_group_jid, wa_instance_id, instances:wa_instance_id(waclaw_session_id)")
    .eq("id", id)
    .single();

  const internalQ = await supabase
    .from("task_thread")
    .select("id, source, body, author_user_id, ts, created_at, media_url, media_type")
    .eq("task_id", id)
    .eq("source", "internal_comment")
    .order("ts", { ascending: true });

  type ThreadItem = {
    id: string;
    source: "wa_group" | "internal_comment";
    body: string | null;
    senderName: string | null;
    fromMe: boolean;
    timestamp: number;
    mediaUrl?: string | null;
    mediaType?: string | null;
  };
  const items: ThreadItem[] = [];

  // Internal comments (always included, even if no group)
  for (const c of internalQ.data ?? []) {
    items.push({
      id: `c:${c.id}`,
      source: "internal_comment",
      body: c.body,
      senderName: c.author_user_id?.slice(0, 8) ?? null,
      fromMe: c.author_user_id === user.id,
      timestamp: Number(c.ts),
      mediaUrl: c.media_url,
      mediaType: c.media_type,
    });
  }

  // Group messages, when the task has a WA group
  const inst = Array.isArray(task?.instances) ? task?.instances?.[0] : task?.instances;
  const sessionId = (inst as { waclaw_session_id: string | null } | undefined)?.waclaw_session_id ?? null;
  if (task?.wa_group_jid && sessionId) {
    try {
      const msgsRes = await fetch(
        `${env.WACLAW_URL}/sessions/${sessionId}/messages/${encodeURIComponent(task.wa_group_jid)}?limit=200`,
        { headers: { "X-API-Key": env.WACLAW_API_KEY } },
      );
      if (msgsRes.ok) {
        const data = (await msgsRes.json()) as GroupMessage[];
        for (const m of data) {
          items.push({
            id: `m:${m.id}`,
            source: "wa_group",
            body: m.text ?? m.mediaCaption ?? null,
            senderName: m.senderName ?? null,
            fromMe: m.fromMe,
            timestamp: m.timestamp < 1e12 ? m.timestamp * 1000 : m.timestamp,
          });
        }
      }
    } catch {
      // best-effort; surface empty thread if the daemon is unreachable
    }
  }

  items.sort((a, b) => a.timestamp - b.timestamp);
  return Response.json({ items, group_jid: task?.wa_group_jid ?? null });
}

const PostSchema = z.object({
  body: z.string().min(1).max(16_000),
  visibility: z.enum(["all", "internal"]).default("all"),
});

// POST /api/tasks/[id]/thread — sends a message. visibility=all routes it to
// the WA group; visibility=internal just records an internal comment.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const parsed = PostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid payload", issues: parsed.error.issues }, { status: 400 });
  }
  const { body, visibility } = parsed.data;
  const nowMs = Date.now();

  const supabase = getSupabaseServer();

  if (visibility === "internal") {
    const { data, error } = await supabase
      .from("task_thread")
      .insert({
        task_id: id,
        source: "internal_comment",
        author_user_id: user.id,
        body,
        ts: nowMs,
      })
      .select()
      .single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ item: data }, { status: 201 });
  }

  // visibility=all → send to WA group (if any). Without a group, fall back to
  // internal comment so the message isn't silently dropped.
  const { data: task } = await supabase
    .from("tasks")
    .select("wa_group_jid, wa_instance_id, instances:wa_instance_id(waclaw_session_id)")
    .eq("id", id)
    .single();
  const inst = Array.isArray(task?.instances) ? task?.instances?.[0] : task?.instances;
  const sessionId = (inst as { waclaw_session_id: string | null } | undefined)?.waclaw_session_id ?? null;
  if (!task?.wa_group_jid || !sessionId) {
    return Response.json(
      { error: "task has no WhatsApp group; use visibility=internal" },
      { status: 400 },
    );
  }

  const sendRes = await fetch(`${env.WACLAW_URL}/sessions/${sessionId}/send`, {
    method: "POST",
    headers: { "X-API-Key": env.WACLAW_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ chatJid: task.wa_group_jid, text: body }),
  });
  if (!sendRes.ok) {
    return Response.json({ error: "send failed" }, { status: 502 });
  }
  return Response.json({ ok: true, sent_to: task.wa_group_jid });
}
