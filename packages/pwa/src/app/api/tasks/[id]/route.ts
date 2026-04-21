export const dynamic = "force-dynamic";

import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";
import { env } from "@/lib/env";

// GET /api/tasks/[id]
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

  const { data: task, error } = await supabase
    .from("tasks")
    .select(`
      *,
      task_participants(id, user_id, contact_jid, instance_id, role, joined_group_at, join_failure, added_at)
    `)
    .eq("id", id)
    .single();

  if (error) return Response.json({ error: error.message }, { status: 404 });

  const isCreator = task.creator_id === user.id;
  const isParticipant = task.task_participants?.some(
    (p: { user_id: string | null }) => p.user_id === user.id,
  );
  if (!isCreator && !isParticipant) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  return Response.json({ task });
}

// PATCH /api/tasks/[id]
// body: any subset of { title, description, priority, status, assigned_to, due_date }
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const supabase = getSupabaseServer();

  const { data: existing } = await supabase
    .from("tasks")
    .select("creator_id, title, status, wa_group_jid, wa_instance_id, instances:wa_instance_id(waclaw_session_id)")
    .eq("id", id)
    .single();
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
  if (existing.creator_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const allowed = ["title", "description", "priority", "status", "assigned_to", "due_date"];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  if (updates.status === "resolved") updates.resolved_at = new Date().toISOString();
  if (updates.status === "closed") updates.closed_at = new Date().toISOString();

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const { data: task, error } = await supabase
    .from("tasks")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // When a task transitions to closed, rename the backing WA group to signal
  // it's archived. Kept in-group so participants still have the history but
  // see it's done. Truncated to fit WhatsApp's 25-char group name limit.
  if (
    updates.status === "closed" &&
    existing.wa_group_jid &&
    existing.status !== "closed"
  ) {
    const inst = Array.isArray(existing.instances) ? existing.instances[0] : existing.instances;
    const sessionId = (inst as { waclaw_session_id: string | null } | undefined)?.waclaw_session_id ?? null;
    if (sessionId) {
      const newName = `[ARQUIVADO] ${existing.title}`.slice(0, 25);
      try {
        await fetch(
          `${env.WACLAW_URL}/sessions/${sessionId}/groups/${encodeURIComponent(existing.wa_group_jid)}/subject`,
          {
            method: "POST",
            headers: { "X-API-Key": env.WACLAW_API_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({ name: newName }),
          },
        );
      } catch {
        // best-effort; rename failure doesn't break the status change
      }
    }
  }

  return Response.json({ task });
}

// DELETE /api/tasks/[id]
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const supabase = getSupabaseServer();

  const { error } = await supabase
    .from("tasks")
    .delete()
    .eq("id", id)
    .eq("creator_id", user.id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
