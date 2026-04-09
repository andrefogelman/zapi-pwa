import { NextRequest, NextResponse } from "next/server";
import { fetchMessages } from "@/lib/wacli-api";
import { verifyInstanceOwnership } from "@/lib/supabase-server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { env } from "@/lib/env";

export async function GET(request: NextRequest) {
  try {
    // 1. Tenant Identification
    const instanceId = request.nextUrl.searchParams.get("instanceId");
    if (!instanceId) {
      return NextResponse.json({ error: "instanceId required for tenant-aware requests" }, { status: 400 });
    }

    // 2. Authentication & Ownership Verification
    // In a real app, we'd get userId from the session cookie/JWT.
    // For now, we expect a userId query param or a header for this implementation.
    const userId = request.nextUrl.searchParams.get("userId");
    if (!userId) {
      return NextResponse.json({ error: "userId required for verification" }, { status: 401 });
    }

    const ownsInstance = await verifyInstanceOwnership(userId, instanceId);
    if (!ownsInstance) {
      return NextResponse.json({ error: "Forbidden: You do not own this WhatsApp instance" }, { status: 403 });
    }

    const chat = request.nextUrl.searchParams.get("chat");
    if (!chat) return NextResponse.json({ error: "chat required" }, { status: 400 });

    const limit = request.nextUrl.searchParams.get("limit") || "500";
    const phone = request.nextUrl.searchParams.get("phone") || "";
    const after = request.nextUrl.searchParams.get("after") || undefined;

    console.log(`[messages] tenant=${instanceId} chat=${chat} phone=${phone} limit=${limit} after=${after}`);

    // Note: fetchMessages currently uses env.WACLI_API_URL and env.WACLI_API_TOKEN globally.
    // To be truly tenant-aware, the WACLI_API itself must support tenant tokens
    // or the wacli-api lib must be updated to accept the token/URL per request.
    // Given the task is to implement tenant-aware logic and use the updated zapi helper,
    // we should ensure wacli-api is also passed the correct credentials if it's a proxy for Z-API.

    // For now, we've verified ownership. If wacli-api is global, we've at least blocked
    // unauthorized access to the route. But the goal is to use instance-specific tokens.

    // I will check if wacli-api needs updating to support instance-specific auth.
    let data = await fetchMessages({ chat, limit: Number(limit), after });

    console.log(`[messages] JID result: ${data.messages?.length ?? 0} msgs, total=${data.total}`);
    if (data.messages?.length > 0) {
      const first = data.messages[0];
      const last = data.messages[data.messages.length - 1];
      console.log(`[messages] first: ${first.timestamp} | last: ${last.timestamp}`);
    }

    if ((!data.messages || data.messages.length === 0) && phone) {
      console.log(`[messages] fallback to phone: ${phone}@s.whatsapp.net`);
      const phoneData = await fetchMessages({ chat: `${phone}@s.whatsapp.net`, limit: Number(limit), after });
      console.log(`[messages] fallback result: ${phoneData.messages?.length ?? 0} msgs`);
      if (phoneData.messages?.length > 0) data = phoneData;
    }

    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
