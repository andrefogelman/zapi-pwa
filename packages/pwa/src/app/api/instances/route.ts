export const dynamic = "force-dynamic";
import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("instances")
    .select("id, name, zapi_instance_id, status, connected_phone, provider, waclaw_session_id, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

export async function POST(request: Request) {
  const token = request.headers.get("Authorization")?.replace(/^[Bb]earer\s+/, "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { name } = body;
  // New instances are always waclaw. Z-API legacy stays for existing rows only.
  const provider = "waclaw";

  const supabase = getSupabaseServer();

  // Create waclaw session on worker5. Wrap the whole call in try/catch so
  // network-level errors (DNS, ECONNREFUSED, timeout) surface as 502 rather
  // than a generic 500.
  const waclawUrl = process.env.WACLAW_URL ?? "http://100.66.83.22:3100";
  const waclawKey = process.env.WACLAW_API_KEY ?? "waclaw-dev-key";
  let sessionId: string;
  try {
    const sessionRes = await fetch(`${waclawUrl}/sessions`, {
      method: "POST",
      headers: { "X-API-Key": waclawKey, "Content-Type": "application/json" },
      body: JSON.stringify({ name: name ?? "Minha Instância" }),
    });
    if (!sessionRes.ok) {
      return Response.json(
        { error: `waclaw session creation failed: ${sessionRes.status}` },
        { status: 502 }
      );
    }
    ({ id: sessionId } = await sessionRes.json());
  } catch (err) {
    return Response.json(
      { error: `waclaw unreachable: ${String(err)}` },
      { status: 502 }
    );
  }

  const { data, error } = await supabase
    .from("instances")
    .insert({
      user_id: user.id,
      name: name ?? "Minha Instância",
      provider,
      zapi_instance_id: "",
      zapi_token: "",
      zapi_client_token: null,
      waclaw_session_id: sessionId,
      status: "connecting",
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data, { status: 201 });
}
