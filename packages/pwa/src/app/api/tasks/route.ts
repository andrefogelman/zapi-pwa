export const dynamic = "force-dynamic";

import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";

// GET /api/tasks?status=open&priority=high
export async function GET(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const priority = url.searchParams.get("priority");

  const supabase = getSupabaseServer();

  // Tasks where user is creator OR participant
  let query = supabase
    .from("tasks")
    .select(`
      *,
      task_participants(id, user_id, contact_jid, instance_id, role),
      task_conversations(id, instance_id, chat_jid, chat_name),
      task_comments(count)
    `)
    .or(`creator_id.eq.${user.id},task_participants.user_id.eq.${user.id}`)
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

  const body = await request.json();
  const { title, description, priority, due_date } = body;

  if (!title?.trim()) {
    return Response.json({ error: "title is required" }, { status: 400 });
  }

  const supabase = getSupabaseServer();

  const { data: task, error } = await supabase
    .from("tasks")
    .insert({
      creator_id: user.id,
      title: title.trim(),
      description: description || null,
      priority: priority || "medium",
      due_date: due_date || null,
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Auto-add creator as owner participant
  await supabase.from("task_participants").insert({
    task_id: task.id,
    user_id: user.id,
    role: "owner",
  });

  return Response.json({ task }, { status: 201 });
}
