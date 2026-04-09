import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getZapiBase } from "@/lib/zapi";
import { sessionCache } from "@/lib/redis";

/**
 * POST /api/instances/qr
 * Triggers the QR code generation for a specific instance.
 * Expects { instance_id: string } in body.
 */
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
    const { instance_id } = body;

    if (!instance_id) {
      return NextResponse.json({ error: "instance_id is required" }, { status: 400 });
    }

    // Tenant Isolation: Verify that the instance belongs to the user
    const { data: instance, error: instanceError } = await supabase
      .from("instances")
      .select("token, client_token, instance_id")
      .eq("id", instance_id) // Assuming instance_id in body is the primary key 'id' of the table
      .eq("user_id", user.id)
      .single();

    if (instanceError || !instance) {
      return NextResponse.json({ error: "Instance not found or unauthorized" }, { status: 404 });
    }

    // Z-API requires the instance ID and token for the request.
    // getZapiBase currently uses getZapiConfig which reads from process.env.
    // We need to modify getZapiBase or create a custom request to use the instance's specific token.

    const { baseUrl: _baseUrl, headers: _headers } = await getZapiBase();
    // Note: getZapiBase uses process.env. We need to override it with the instance's specific tokens.
    // This indicates that getZapiBase needs a refactor to accept instance details.

    // For now, we'll manually construct the request since we have the instance tokens.
    // Z-API QR route: /instance/qr
    // Based on the helper, the base is: https://api.z-api.io/instances/{id}/token/{token}
    // But for QR, it might be different. Let's check Z-API docs or follow the helper's pattern.

    const zapiBaseUrl = `https://api.z-api.io/instances/${instance.instance_id}/token/${instance.token}`;
    const zapiHeaders = {
      "Content-Type": "application/json",
      ...(instance.client_token ? { "Client-Token": instance.client_token } : {})
    };

    const response = await fetch(`${zapiBaseUrl}/instance/qr`, {
      method: "GET",
      headers: zapiHeaders,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ error: `Z-API error: ${errorText}` }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /api/instances/qr
 * Checks the connection status of an instance.
 * Expects ?instance_id=... query parameter.
 */
export async function GET(request: NextRequest) {
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

    const { searchParams } = new URL(request.url);
    const instance_id = searchParams.get("instance_id");

    if (!instance_id) {
      return NextResponse.json({ error: "instance_id is required" }, { status: 400 });
    }

    const { data: instance, error: instanceError } = await supabase
      .from("instances")
      .select("token, client_token, instance_id")
      .eq("id", instance_id)
      .eq("user_id", user.id)
      .single();

    if (instanceError || !instance) {
      return NextResponse.json({ error: "Instance not found or unauthorized" }, { status: 404 });
    }

    const zapiBaseUrl = `https://api.z-api.io/instances/${instance.instance_id}/token/${instance.token}`;
    const zapiHeaders = {
      "Content-Type": "application/json",
      ...(instance.client_token ? { "Client-Token": instance.client_token } : {})
    };

    const response = await fetch(`${zapiBaseUrl}/instance/status`, {
      method: "GET",
      headers: zapiHeaders,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ error: `Z-API error: ${errorText}` }, { status: response.status });
    }

    const statusData = await response.json();

    // If connected, save session token and cache it
    if (statusData.status === "CONNECTED" && statusData.session_token) {
      // Save to Supabase
      await supabase
        .from("instances")
        .update({ session_token: statusData.session_token })
        .eq("id", instance_id);

      // Cache in Redis
      await sessionCache.set(instance.instance_id, statusData.session_token);
    }

    return NextResponse.json(statusData);

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
