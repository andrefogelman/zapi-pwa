export const dynamic = "force-dynamic";

import { requireSuperAdmin, errorResponse } from "@/lib/admin-auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Use supabaseUser (user JWT client) for the RPC — the function checks auth.uid()
    const { supabaseUser } = await requireSuperAdmin(request);
    const { id } = await params;
    const { role } = await request.json();

    if (role !== "user" && role !== "super_admin") {
      return Response.json({ error: "invalid role" }, { status: 400 });
    }

    const { error } = await supabaseUser.rpc("admin_update_user_role", {
      target_user_id: id,
      new_role: role,
    });
    if (error) {
      if (error.message.includes("cannot demote self")) {
        return Response.json({ error: "cannot demote self" }, { status: 400 });
      }
      if (
        error.message.includes("caller is not super_admin") ||
        error.message.includes("no authenticated caller")
      ) {
        return Response.json({ error: "forbidden" }, { status: 403 });
      }
      if (error.message.includes("invalid role")) {
        return Response.json({ error: "invalid role" }, { status: 400 });
      }
      throw error;
    }

    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
