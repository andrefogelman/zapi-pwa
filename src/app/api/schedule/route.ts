import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { recipient, contactName, chatJid, contentType, content, mediaUrl, mediaFilename,
            scheduledAt, isRecurring, recurrencePattern, recurrenceInterval, recurrenceDays, recurrenceEndDate } = body;

    if (!recipient || !scheduledAt) {
      return NextResponse.json({ error: "recipient and scheduledAt required" }, { status: 400 });
    }

    const supabase = getSupabaseServer();
    const { data, error } = await supabase.from("scheduled_messages").insert({
      recipient,
      contact_name: contactName || "",
      chat_jid: chatJid || "",
      content_type: contentType || "text",
      content: content || "",
      media_url: mediaUrl || null,
      media_filename: mediaFilename || null,
      scheduled_at: scheduledAt,
      is_recurring: isRecurring || false,
      recurrence_pattern: recurrencePattern || null,
      recurrence_interval: recurrenceInterval || 1,
      recurrence_days: recurrenceDays || null,
      recurrence_end_date: recurrenceEndDate || null,
    }).select().single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ status: "scheduled", id: data.id });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
