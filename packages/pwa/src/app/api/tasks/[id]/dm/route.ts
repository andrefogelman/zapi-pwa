export const dynamic = "force-dynamic";

import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";
import { env } from "@/lib/env";
import { z } from "zod";

// POST /api/tasks/[id]/dm
// body: { contact_jid: "5511...@s.whatsapp.net", body: "..." }
//
// Sends a direct message to a single participant (NOT to the task's WA group).
// Useful for chasing someone who hasn't responded, or asking a private
// follow-up without spamming every other participant.
const Schema = z.object({
  contact_jid: z.string().min(3).max(128),
  body: z.string().min(1).max(16_000),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid payload", issues: parsed.error.issues }, { status: 400 });
  }
  const { contact_jid, body } = parsed.data;

  const supabase = getSupabaseServer();
  // Verify the participant belongs to the task AND the task has a wa_instance_id.
  const { data: task } = await supabase
    .from("tasks")
    .select("wa_instance_id, instances:wa_instance_id(waclaw_session_id)")
    .eq("id", id)
    .single();
  const inst = Array.isArray(task?.instances) ? task?.instances?.[0] : task?.instances;
  const sessionId = (inst as { waclaw_session_id: string | null } | undefined)?.waclaw_session_id ?? null;
  if (!sessionId) {
    return Response.json({ error: "task has no connected instance" }, { status: 400 });
  }

  const { data: participant } = await supabase
    .from("task_participants")
    .select("id")
    .eq("task_id", id)
    .eq("contact_jid", contact_jid)
    .maybeSingle();
  if (!participant) {
    return Response.json({ error: "contact is not a participant of this task" }, { status: 403 });
  }

  const res = await fetch(`${env.WACLAW_URL}/sessions/${sessionId}/send`, {
    method: "POST",
    headers: { "X-API-Key": env.WACLAW_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ chatJid: contact_jid, text: body }),
  });
  if (!res.ok) {
    return Response.json({ error: "send failed" }, { status: 502 });
  }
  return Response.json({ ok: true });
}
