import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";

export async function POST(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { endpoint, keys_p256dh, keys_auth } = await request.json();
  if (!endpoint || !keys_p256dh || !keys_auth) {
    return Response.json({ error: "Missing subscription data" }, { status: 400 });
  }

  const supabase = getSupabaseServer();
  await supabase.from("push_subscriptions").upsert(
    { user_id: user.id, endpoint, keys_p256dh, keys_auth },
    { onConflict: "endpoint" }
  );

  return Response.json({ ok: true });
}
