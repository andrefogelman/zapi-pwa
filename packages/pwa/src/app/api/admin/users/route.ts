export const dynamic = "force-dynamic";

import { requireSuperAdmin, errorResponse } from "@/lib/admin-auth";

export async function GET(request: Request) {
  try {
    const { supabaseAdmin } = await requireSuperAdmin(request);

    const { data: authList, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (listErr) throw listErr;

    const userIds = authList.users.map((u) => u.id);

    const [settingsRes, instancesRes] = await Promise.all([
      supabaseAdmin
        .from("user_settings")
        .select("user_id, display_name, role, status, transcription_footer, created_at")
        .in("user_id", userIds),
      supabaseAdmin
        .from("instances")
        .select("user_id")
        .in("user_id", userIds),
    ]);

    const settingsByUser = new Map(
      (settingsRes.data ?? []).map((s: { user_id: string }) => [s.user_id, s]),
    );
    const instanceCount = new Map<string, number>();
    for (const i of (instancesRes.data ?? []) as { user_id: string }[]) {
      instanceCount.set(i.user_id, (instanceCount.get(i.user_id) ?? 0) + 1);
    }

    const users = authList.users.map((u) => {
      const s = (settingsByUser.get(u.id) as
        | {
            display_name: string | null;
            role: string | null;
            status: string | null;
            transcription_footer: string | null;
            created_at: string | null;
          }
        | undefined) ?? {
        display_name: null,
        role: null,
        status: null,
        transcription_footer: null,
        created_at: null,
      };
      return {
        id: u.id,
        email: u.email,
        last_sign_in_at: u.last_sign_in_at,
        is_pending_invite: !u.last_sign_in_at && !u.confirmed_at,
        display_name: s.display_name,
        role: s.role,
        status: s.status,
        created_at: s.created_at,
        instance_count: instanceCount.get(u.id) ?? 0,
      };
    });

    return Response.json({ users });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { supabaseAdmin } = await requireSuperAdmin(request);
    const { email } = await request.json();
    if (typeof email !== "string" || !email.includes("@")) {
      return Response.json({ error: "invalid email" }, { status: 400 });
    }

    const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/auth/callback`;
    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
    });
    if (error) throw error;

    return Response.json({ user_id: data.user?.id, invite_sent: true });
  } catch (err) {
    return errorResponse(err);
  }
}
