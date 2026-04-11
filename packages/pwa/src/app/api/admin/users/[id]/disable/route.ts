export const dynamic = "force-dynamic";

import { requireSuperAdmin, errorResponse } from "@/lib/admin-auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabaseUser, supabaseAdmin } = await requireSuperAdmin(request);
    const { id } = await params;
    const { disabled } = await request.json();

    if (typeof disabled !== "boolean") {
      return Response.json({ error: "disabled must be boolean" }, { status: 400 });
    }

    const newStatus = disabled ? "disabled" : "active";

    const { error: rpcErr } = await supabaseUser.rpc("admin_update_user_status", {
      target_user_id: id,
      new_status: newStatus,
    });
    if (rpcErr) {
      if (rpcErr.message.includes("cannot disable self")) {
        return Response.json({ error: "cannot disable self" }, { status: 400 });
      }
      if (
        rpcErr.message.includes("caller is not super_admin") ||
        rpcErr.message.includes("no authenticated caller")
      ) {
        return Response.json({ error: "forbidden" }, { status: 403 });
      }
      throw rpcErr;
    }

    // Also invalidate / restore auth sessions via service role.
    // Two-step operation is NOT atomic: if this step fails, user_settings.status
    // is already set but auth sessions remain valid (or conversely, re-enabling
    // fails to restore sessions). We log loudly so an operator can reconcile
    // manually via the Supabase dashboard if this diverges.
    const banDuration = disabled ? "876000h" : "none";
    const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(id, {
      ban_duration: banDuration,
    });
    if (authErr) {
      console.error(
        "disable: RPC succeeded but auth ban update failed — inconsistent state",
        { user_id: id, new_status: newStatus, ban_duration: banDuration, authErr }
      );
      throw authErr;
    }

    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
