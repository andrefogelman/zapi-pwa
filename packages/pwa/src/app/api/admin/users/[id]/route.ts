export const dynamic = "force-dynamic";

import { requireSuperAdmin, errorResponse } from "@/lib/admin-auth";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, supabaseAdmin } = await requireSuperAdmin(request);
    const { id } = await params;

    if (id === user.id) {
      return Response.json({ error: "cannot delete self" }, { status: 400 });
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
    if (error) throw error;
    // Cascades: user_settings, instances → messages → transcriptions, instance_groups, push_subscriptions
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
