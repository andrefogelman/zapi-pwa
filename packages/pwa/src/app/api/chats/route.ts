export const dynamic = "force-dynamic";
import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";
import { getZapiClient } from "@/lib/zapi";

export async function GET(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const instance_id = url.searchParams.get("instance_id");
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

  const page = url.searchParams.get("page") || "1";
  const pageSize = url.searchParams.get("pageSize") || "100";

  const client = await getZapiClient(instance_id);
  const res = await fetch(`${client.baseUrl}/chats?page=${page}&pageSize=${pageSize}`, { headers: client.headers });

  if (!res.ok) {
    return Response.json({ error: `Z-API error: ${await res.text()}` }, { status: res.status });
  }

  const chats = await res.json();

  // Filter and format
  const formatted = (chats as Record<string, unknown>[])
    .filter((c) => c.phone !== "0" && c.phone)
    .sort((a, b) => Number(b.lastMessageTime || 0) - Number(a.lastMessageTime || 0))
    .map((c) => ({
      phone: c.phone as string,
      name: (c.name as string) || (c.phone as string),
      isGroup: c.isGroup as boolean,
      lastMessageTime: Number(c.lastMessageTime || 0),
      unread: Number(c.unread || 0),
    }));

  return Response.json(formatted);
}
