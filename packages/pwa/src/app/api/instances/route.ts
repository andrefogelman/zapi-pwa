export const dynamic = "force-dynamic";
import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";
import { env } from "@/lib/env";
import { z } from "zod";

const CreateInstanceSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
});
const ReorderSchema = z.object({
  order: z.array(z.string().uuid()).min(1).max(100),
});

export async function GET(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("instances")
    .select("id, name, zapi_instance_id, status, connected_phone, provider, waclaw_session_id, sort_order, created_at")
    .eq("user_id", user.id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

// PATCH /api/instances — reorder. Body: { order: string[] } (ids in new order).
export async function PATCH(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parse = ReorderSchema.safeParse(await request.json().catch(() => null));
  if (!parse.success) {
    return Response.json({ error: "invalid payload", issues: parse.error.issues }, { status: 400 });
  }
  const { order } = parse.data;

  const supabase = getSupabaseServer();
  // Issue one UPDATE per id — tiny N (usually ≤ 10), not worth a bulk-RPC.
  for (let i = 0; i < order.length; i++) {
    const { error } = await supabase
      .from("instances")
      .update({ sort_order: i })
      .eq("id", order[i])
      .eq("user_id", user.id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ ok: true });
}

export async function POST(request: Request) {
  const token = request.headers.get("Authorization")?.replace(/^[Bb]earer\s+/, "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = CreateInstanceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid payload", issues: parsed.error.issues }, { status: 400 });
  }
  const { name } = parsed.data;
  // New instances are always waclaw. Z-API legacy stays for existing rows only.
  const provider = "waclaw";

  const supabase = getSupabaseServer();

  // Create waclaw session on worker5. Wrap the whole call in try/catch so
  // network-level errors (DNS, ECONNREFUSED, timeout) surface as 502 rather
  // than a generic 500.
  let sessionId: string;
  try {
    const sessionRes = await fetch(`${env.WACLAW_URL}/sessions`, {
      method: "POST",
      headers: { "X-API-Key": env.WACLAW_API_KEY, "Content-Type": "application/json" },
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
