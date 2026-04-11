export const dynamic = "force-dynamic";

import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";

// DELETE /api/scheduled/:id — cancel a pending scheduled message.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("waclaw_scheduled_messages")
    .update({ status: "canceled" })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("status", "pending")
    .select()
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) {
    return Response.json(
      { error: "Not found or already processed" },
      { status: 404 }
    );
  }
  return Response.json({ ok: true });
}
