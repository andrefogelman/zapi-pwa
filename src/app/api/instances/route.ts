import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseServer();

    // The user is authenticated via the request context (Supabase Auth)
    // Since we are using the service role key in getSupabaseServer,
    // we need to manually verify the user's token from the Authorization header
    const authHeader = request.headers.get("Authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Missing Authorization header" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: instances, error: instancesError } = await supabase
      .from("instances")
      .select("*")
      .eq("user_id", user.id);

    if (instancesError) {
      return NextResponse.json({ error: instancesError.message }, { status: 500 });
    }

    return NextResponse.json(instances);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseServer();
    const authHeader = request.headers.get("Authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Missing Authorization header" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { instance_id, token: instance_token, client_token } = body;

    if (!instance_id || !instance_token) {
      return NextResponse.json({ error: "instance_id and token are required" }, { status: 400 });
    }

    const { data, error: insertError } = await supabase
      .from("instances")
      .insert({
        user_id: user.id,
        instance_id,
        token: instance_token,
        client_token,
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
