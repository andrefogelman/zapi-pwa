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
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { name, provider = "zapi", zapi_instance_id, zapi_token, zapi_client_token, waclaw_session_id } = body;

  if (provider === "zapi" && (!zapi_instance_id || !zapi_token)) {
    return Response.json({ error: "zapi_instance_id and zapi_token are required for Z-API" }, { status: 400 });
  }

  const supabase = getSupabaseServer();

  const insertData: Record<string, unknown> = {
    user_id: user.id,
    name: name || "Minha Instância",
    provider,
    zapi_instance_id: zapi_instance_id || "",
    zapi_token: zapi_token || "",
    zapi_client_token: zapi_client_token || null,
    waclaw_session_id: waclaw_session_id || null,
  };

  // For WaClaw, create a session on the WaClaw service
  if (provider === "waclaw" && !waclaw_session_id) {
    const waclawUrl = process.env.WACLAW_URL || "http://100.66.83.22:3100";
    const waclawKey = process.env.WACLAW_API_KEY || "waclaw-dev-key";
    const res = await fetch(`${waclawUrl}/sessions`, {
      method: "POST",
      headers: { "X-API-Key": waclawKey, "Content-Type": "application/json" },
    });
    if (res.ok) {
      const { id: sessionId } = await res.json();
      insertData.waclaw_session_id = sessionId;
    }
  }

  const { data, error } = await supabase
    .from("instances")
    .insert(insertData)
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data, { status: 201 });
}
