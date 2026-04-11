export const dynamic = "force-dynamic";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function POST(request: Request) {
  const { userId, title, body, url } = await request.json();
  if (!userId) return Response.json({ error: "userId required" }, { status: 400 });

  const supabase = getSupabaseServer();
  const { data: subscriptions } = await supabase
    .from("push_subscriptions")
    .select("endpoint, keys_p256dh, keys_auth")
    .eq("user_id", userId);

  if (!subscriptions || subscriptions.length === 0) {
    return Response.json({ sent: 0 });
  }

  const webpush = await import("web-push");
  webpush.setVapidDetails(
    "mailto:noreply@transcritor.app",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );

  let sent = 0;
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
        },
        JSON.stringify({ title: title || "Transcrição pronta", body, url })
      );
      sent++;
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 410) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      }
    }
  }

  return Response.json({ sent });
}
