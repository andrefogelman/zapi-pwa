export const dynamic = "force-dynamic";

import { requireSuperAdmin, errorResponse } from "@/lib/admin-auth";

export async function GET(request: Request) {
  try {
    const { supabaseAdmin } = await requireSuperAdmin(request);

    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const iso = startOfDay.toISOString();

    const [
      { count: total_users },
      { count: connected_instances },
      { count: transcribed_today },
      { count: failed_today },
    ] = await Promise.all([
      supabaseAdmin.from("user_settings").select("*", { count: "exact", head: true }),
      supabaseAdmin
        .from("instances")
        .select("*", { count: "exact", head: true })
        .eq("status", "connected"),
      supabaseAdmin
        .from("transcriptions")
        .select("*", { count: "exact", head: true })
        .gte("created_at", iso),
      supabaseAdmin
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("status", "transcription_failed")
        .gte("timestamp", iso),
    ]);

    return Response.json({
      total_users: total_users ?? 0,
      connected_instances: connected_instances ?? 0,
      transcribed_today: transcribed_today ?? 0,
      failed_today: failed_today ?? 0,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
