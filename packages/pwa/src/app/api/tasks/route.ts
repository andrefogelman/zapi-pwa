export const dynamic = "force-dynamic";

import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";
import { z } from "zod";
import { env } from "@/lib/env";

const StatusSchema = z.enum(["open", "in_progress", "resolved", "closed"]);
const PrioritySchema = z.enum(["low", "medium", "high", "urgent"]);

const ParticipantSeedSchema = z.object({
  contact_jid: z.string().min(3).max(128),
  contact_name: z.string().max(128).optional(),
});

const CreateTaskSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().max(8_000).nullable().optional(),
  priority: PrioritySchema.optional(),
  due_date: z.string().datetime().nullable().optional(),
  // Optional: when supplied, the task spins up a WhatsApp group with these
  // participants and sends the invitation message.
  instance_id: z.string().uuid().optional(),
  participants: z.array(ParticipantSeedSchema).max(50).optional(),
});

// Invitation sent as the first message in the WA group. {OWNER} and {TITLE}
// are placeholders; description is appended if present.
function buildInvitationText(owner: string, title: string, description: string | null) {
  const header = `📋 *${title}*\n\nResponda para participar, a convite de *${owner}*, na resolução da tarefa.`;
  return description ? `${header}\n\n${description}` : header;
}

// GET /api/tasks?status=open&priority=high
export async function GET(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const statusRaw = url.searchParams.get("status");
  const priorityRaw = url.searchParams.get("priority");
  // Validate against the enum. Invalid values are ignored (404-equivalent)
  // rather than echoed back into the SQL filter.
  const status = statusRaw && StatusSchema.safeParse(statusRaw).success ? statusRaw : null;
  const priority = priorityRaw && PrioritySchema.safeParse(priorityRaw).success ? priorityRaw : null;

  const supabase = getSupabaseServer();

  // Fetch task IDs the user can access (creator or participant)
  const { data: ownedRows } = await supabase
    .from("tasks")
    .select("id")
    .eq("creator_id", user.id);
  const { data: participantRows } = await supabase
    .from("task_participants")
    .select("task_id")
    .eq("user_id", user.id);

  const taskIds = new Set<string>();
  for (const r of ownedRows || []) taskIds.add(r.id);
  for (const r of participantRows || []) taskIds.add(r.task_id);

  if (taskIds.size === 0) {
    return Response.json({ tasks: [] });
  }

  let query = supabase
    .from("tasks")
    .select(`
      *,
      task_participants(id, user_id, contact_jid, instance_id, role, joined_group_at, join_failure)
    `)
    .in("id", [...taskIds])
    .order("created_at", { ascending: false });

  if (status) query = query.eq("status", status);
  if (priority) query = query.eq("priority", priority);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ tasks: data || [] });
}

// POST /api/tasks
// body: { title, description?, priority?, due_date? }
export async function POST(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parse = CreateTaskSchema.safeParse(await request.json().catch(() => null));
  if (!parse.success) {
    return Response.json({ error: "invalid payload", issues: parse.error.issues }, { status: 400 });
  }
  const { title, description, priority, due_date, instance_id, participants } = parse.data;

  const supabase = getSupabaseServer();

  // If the caller asks for a WA group, resolve the instance/session first so
  // we fail fast before creating the task row.
  let instance: { id: string; waclaw_session_id: string | null; user_id: string } | null = null;
  if (instance_id && participants && participants.length > 0) {
    const { data } = await supabase
      .from("instances")
      .select("id, waclaw_session_id, user_id")
      .eq("id", instance_id)
      .eq("user_id", user.id)
      .single();
    if (!data || !data.waclaw_session_id) {
      return Response.json({ error: "instance not found or not connected" }, { status: 400 });
    }
    instance = data;
  }

  const { data: task, error } = await supabase
    .from("tasks")
    .insert({
      creator_id: user.id,
      title,
      description: description ?? null,
      priority: priority ?? "medium",
      due_date: due_date ?? null,
      wa_instance_id: instance?.id ?? null,
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Creator is always the owner participant.
  await supabase.from("task_participants").insert({
    task_id: task.id,
    user_id: user.id,
    role: "owner",
  });

  // WA group spin-up is best-effort: if it fails we still return the task so
  // the user can retry or fall back to internal-only mode.
  let groupInfo: { jid: string; name: string } | null = null;
  if (instance && participants && participants.length > 0) {
    try {
      const ownerDisplay = user.user_metadata?.full_name || user.email || "equipe";
      const groupNameBase = `falabem ${title}`.slice(0, 25);
      const createRes = await fetch(
        `${env.WACLAW_URL}/sessions/${instance.waclaw_session_id}/groups/create`,
        {
          method: "POST",
          headers: {
            "X-API-Key": env.WACLAW_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: groupNameBase,
            participants: participants.map((p) => p.contact_jid),
          }),
        },
      );
      if (createRes.ok) {
        const body = await createRes.json();
        groupInfo = { jid: body.jid, name: body.name };
        await supabase
          .from("tasks")
          .update({
            wa_group_jid: body.jid,
            wa_group_created_at: new Date().toISOString(),
          })
          .eq("id", task.id);
        // Seed participant rows (as contacts).
        for (const p of participants) {
          await supabase.from("task_participants").insert({
            task_id: task.id,
            contact_jid: p.contact_jid,
            instance_id: instance.id,
            role: "member",
            joined_group_at: new Date().toISOString(),
          });
        }
        // Send the invitation message into the freshly-created group.
        const invitation = buildInvitationText(ownerDisplay, title, description ?? null);
        await fetch(`${env.WACLAW_URL}/sessions/${instance.waclaw_session_id}/send`, {
          method: "POST",
          headers: {
            "X-API-Key": env.WACLAW_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ chatJid: body.jid, text: invitation }),
        });
      } else {
        // Record a join_failure on the owner participant row so the UI can
        // show the user what went wrong.
        const reason = (await createRes.text()).slice(0, 400);
        await supabase.from("task_participants").insert({
          task_id: task.id,
          contact_jid: "group-create",
          instance_id: instance.id,
          role: "observer",
          join_failure: reason,
        });
      }
    } catch (err) {
      await supabase.from("task_participants").insert({
        task_id: task.id,
        contact_jid: "group-create",
        instance_id: instance.id,
        role: "observer",
        join_failure: String(err).slice(0, 400),
      });
    }
  }

  return Response.json({ task, group: groupInfo }, { status: 201 });
}
