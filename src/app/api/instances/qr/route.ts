import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";
import { getZapiClient } from "@/lib/zapi";
import { sessionCache } from "@/lib/redis";

/** POST: Trigger QR code generation for an instance */
export async function POST(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { instance_id } = await request.json();
  if (!instance_id) return Response.json({ error: "instance_id required" }, { status: 400 });

  // Verify ownership
  const supabase = getSupabaseServer();
  const { data: instance } = await supabase
    .from("instances")
    .select("id")
    .eq("id", instance_id)
    .eq("user_id", user.id)
    .single();

  if (!instance) return Response.json({ error: "Instance not found" }, { status: 404 });

  const client = await getZapiClient(instance_id);
  const res = await fetch(`${client.baseUrl}/qr-code`, { headers: client.headers });

  if (!res.ok) {
    return Response.json({ error: `Z-API error: ${await res.text()}` }, { status: res.status });
  }

  // Update status to connecting
  await supabase.from("instances").update({ status: "connecting" }).eq("id", instance_id);

  return Response.json(await res.json());
}

/** GET: Poll connection status */
export async function GET(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const instance_id = url.searchParams.get("instance_id");
  if (!instance_id) return Response.json({ error: "instance_id required" }, { status: 400 });

  const supabase = getSupabaseServer();
  const { data: instance } = await supabase
    .from("instances")
    .select("id, zapi_instance_id")
    .eq("id", instance_id)
    .eq("user_id", user.id)
    .single();

  if (!instance) return Response.json({ error: "Instance not found" }, { status: 404 });

  const client = await getZapiClient(instance_id);
  const res = await fetch(`${client.baseUrl}/status`, { headers: client.headers });

  if (!res.ok) {
    return Response.json({ error: `Z-API error: ${await res.text()}` }, { status: res.status });
  }

  const statusData = await res.json();

  // If connected, persist session
  if (statusData.connected) {
    await supabase
      .from("instances")
      .update({
        status: "connected",
        connected_phone: statusData.phoneConnected || null,
        session_token: statusData.sessionToken || null,
      })
      .eq("id", instance_id);

    await sessionCache.set(instance.zapi_instance_id, statusData.sessionToken || "connected");
  }

  return Response.json(statusData);
}
