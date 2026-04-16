export const dynamic = "force-dynamic";

import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";
import { getSessionStatus } from "@/lib/waclaw";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = request.headers.get("Authorization")?.replace(/^[Bb]earer\s+/, "");
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });
  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const supabase = getSupabaseServer();
  const { data: instance } = await supabase
    .from("instances")
    .select("waclaw_session_id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!instance?.waclaw_session_id) {
    return Response.json({ error: "instance not found or not waclaw" }, { status: 404 });
  }

  try {
    const session = await getSessionStatus(instance.waclaw_session_id);
    if (session.status === "connected" && session.phone) {
      // LID-addressed sessions return "<digits>@lid" instead of a phone number.
      // Split into separate columns so downstream code never has to guess.
      const isLid = session.phone.endsWith("@lid");
      const updates: Record<string, unknown> = {
        status: "connected",
        connected_phone: isLid ? null : session.phone,
        connected_lid: isLid ? session.phone : null,
      };
      if (!isLid) updates.my_phones = [session.phone];
      await supabase.from("instances").update(updates).eq("id", id);
    }
    return Response.json(session);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 });
  }
}
