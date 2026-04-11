export const dynamic = "force-dynamic";

import { requireSuperAdmin, errorResponse } from "@/lib/admin-auth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabaseAdmin } = await requireSuperAdmin(request);
    const { id } = await params;

    const { data: userData, error: lookupErr } = await supabaseAdmin.auth.admin.getUserById(id);
    if (lookupErr || !userData.user?.email) {
      throw lookupErr ?? new Error("user not found or has no email");
    }

    const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/auth/callback`;
    const { error } = await supabaseAdmin.auth.admin.generateLink({
      type: "invite",
      email: userData.user.email,
      options: { redirectTo },
    });
    if (error) throw error;

    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
