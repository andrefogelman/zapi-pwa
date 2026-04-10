import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("instances")
    .select("id, name, zapi_instance_id, status, connected_phone, created_at")
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
  const { name, zapi_instance_id, zapi_token, zapi_client_token } = body;

  if (!zapi_instance_id || !zapi_token) {
    return Response.json({ error: "zapi_instance_id and zapi_token are required" }, { status: 400 });
  }

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("instances")
    .insert({
      user_id: user.id,
      name: name || "Minha Instância",
      zapi_instance_id,
      zapi_token,
      zapi_client_token: zapi_client_token || null,
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data, { status: 201 });
}
