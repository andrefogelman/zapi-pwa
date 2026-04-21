export const dynamic = "force-dynamic";

import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";
import { env } from "@/lib/env";
import { z } from "zod";

const AddSchema = z.object({
  contact_jid: z.string().min(3).max(128).optional(),
  contact_name: z.string().max(128).optional(),
  user_id: z.string().uuid().optional(),
  role: z.enum(["owner", "member", "observer"]).default("member"),
}).refine((v) => !!(v.contact_jid || v.user_id), {
  message: "contact_jid or user_id required",
});

// POST /api/tasks/[id]/participants
// body: { contact_jid?, contact_name?, user_id?, role? }
// When the task has a WA group, the contact is added to the group too.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const parsed = AddSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid payload", issues: parsed.error.issues }, { status: 400 });
  }
  const { contact_jid, user_id, role } = parsed.data;
  const supabase = getSupabaseServer();

  const { data: task } = await supabase
    .from("tasks")
    .select("wa_group_jid, wa_instance_id, instances:wa_instance_id(waclaw_session_id)")
    .eq("id", id)
    .single();
  const inst = Array.isArray(task?.instances) ? task?.instances?.[0] : task?.instances;
  const sessionId = (inst as { waclaw_session_id: string | null } | undefined)?.waclaw_session_id ?? null;

  let joinFailure: string | null = null;
  if (contact_jid && task?.wa_group_jid && sessionId) {
    try {
      const res = await fetch(
        `${env.WACLAW_URL}/sessions/${sessionId}/groups/${encodeURIComponent(task.wa_group_jid)}/participants`,
        {
          method: "POST",
          headers: { "X-API-Key": env.WACLAW_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ add: [contact_jid] }),
        },
      );
      if (!res.ok) {
        joinFailure = (await res.text()).slice(0, 400);
      }
    } catch (err) {
      joinFailure = String(err).slice(0, 400);
    }
  }

  const { data, error } = await supabase
    .from("task_participants")
    .insert({
      task_id: id,
      user_id: user_id ?? null,
      contact_jid: contact_jid ?? null,
      instance_id: task?.wa_instance_id ?? null,
      role,
      joined_group_at: joinFailure ? null : new Date().toISOString(),
      join_failure: joinFailure,
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ participant: data, join_failure: joinFailure }, { status: 201 });
}

// DELETE /api/tasks/[id]/participants?participantId=X
// Also removes the participant from the WA group if they were added there.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const url = new URL(request.url);
  const participantId = url.searchParams.get("participantId");
  if (!participantId) {
    return Response.json({ error: "participantId required" }, { status: 400 });
  }

  const supabase = getSupabaseServer();
  const { data: p } = await supabase
    .from("task_participants")
    .select("contact_jid")
    .eq("id", participantId)
    .eq("task_id", id)
    .single();

  if (p?.contact_jid) {
    const { data: task } = await supabase
      .from("tasks")
      .select("wa_group_jid, instances:wa_instance_id(waclaw_session_id)")
      .eq("id", id)
      .single();
    const inst = Array.isArray(task?.instances) ? task?.instances?.[0] : task?.instances;
    const sessionId = (inst as { waclaw_session_id: string | null } | undefined)?.waclaw_session_id ?? null;
    if (task?.wa_group_jid && sessionId) {
      try {
        await fetch(
          `${env.WACLAW_URL}/sessions/${sessionId}/groups/${encodeURIComponent(task.wa_group_jid)}/participants`,
          {
            method: "POST",
            headers: { "X-API-Key": env.WACLAW_API_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({ remove: [p.contact_jid] }),
          },
        );
      } catch {
        // best-effort
      }
    }
  }

  const { error } = await supabase
    .from("task_participants")
    .delete()
    .eq("id", participantId)
    .eq("task_id", id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
