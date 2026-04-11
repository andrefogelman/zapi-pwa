export const dynamic = "force-dynamic";

import { requireSuperAdmin, errorResponse } from "@/lib/admin-auth";

const ALLOWED_MODELS = ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "whisper-1"];

export async function GET(request: Request) {
  try {
    const { supabaseAdmin } = await requireSuperAdmin(request);
    const { data, error } = await supabaseAdmin
      .from("platform_config")
      .select("*")
      .eq("id", 1)
      .single();
    if (error) throw error;
    return Response.json(data);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const { user, supabaseAdmin } = await requireSuperAdmin(request);
    const body = await request.json();

    const updates: Record<string, unknown> = {};
    if (typeof body.neura_prompt === "string") updates.neura_prompt = body.neura_prompt;
    if (typeof body.neura_model === "string") {
      if (!ALLOWED_MODELS.includes(body.neura_model)) {
        return Response.json({ error: "invalid model" }, { status: 400 });
      }
      updates.neura_model = body.neura_model;
    }
    if (typeof body.neura_temperature === "number") {
      if (body.neura_temperature < 0 || body.neura_temperature > 2) {
        return Response.json({ error: "temperature must be [0,2]" }, { status: 400 });
      }
      updates.neura_temperature = body.neura_temperature;
    }
    if (typeof body.neura_top_p === "number") {
      if (body.neura_top_p < 0 || body.neura_top_p > 1) {
        return Response.json({ error: "top_p must be [0,1]" }, { status: 400 });
      }
      updates.neura_top_p = body.neura_top_p;
    }

    if (Object.keys(updates).length === 0) {
      return Response.json({ error: "no valid fields" }, { status: 400 });
    }
    updates.updated_at = new Date().toISOString();
    updates.updated_by = user.id;

    const { error } = await supabaseAdmin
      .from("platform_config")
      .update(updates)
      .eq("id", 1);
    if (error) throw error;

    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
