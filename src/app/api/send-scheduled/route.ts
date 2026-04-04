import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getZapiConfig } from "@/lib/config";

export const maxDuration = 60;

function calculateNextSchedule(msg: Record<string, unknown>): string | null {
  const pattern = msg.recurrence_pattern as string;
  const interval = (msg.recurrence_interval as number) || 1;
  const endDate = msg.recurrence_end_date as string | null;
  const current = new Date(msg.scheduled_at as string);

  let next: Date;

  switch (pattern) {
    case "daily":
      next = new Date(current);
      next.setDate(next.getDate() + interval);
      break;
    case "weekly": {
      const days = (msg.recurrence_days as number[]) || [];
      if (days.length === 0) {
        next = new Date(current);
        next.setDate(next.getDate() + 7 * interval);
      } else {
        const currentDay = current.getDay();
        const sortedDays = [...days].sort((a, b) => a - b);
        const nextDay = sortedDays.find((d) => d > currentDay);
        next = new Date(current);
        if (nextDay !== undefined) {
          next.setDate(next.getDate() + (nextDay - currentDay));
        } else {
          next.setDate(next.getDate() + (7 - currentDay + sortedDays[0]));
        }
      }
      break;
    }
    case "monthly":
      next = new Date(current);
      next.setMonth(next.getMonth() + interval);
      break;
    default:
      return null;
  }

  if (endDate && next > new Date(endDate)) return null;
  return next.toISOString();
}

export async function GET() {
  const supabase = getSupabaseServer();

  try {
    // Fetch pending messages where scheduled_at <= now
    const { data: messages, error } = await supabase
      .from("scheduled_messages")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(10);

    if (error || !messages || messages.length === 0) {
      return NextResponse.json({ status: "empty", processed: 0 });
    }

    const config = await getZapiConfig();
    const baseUrl = `https://api.z-api.io/instances/${config.instance_id}/token/${config.token}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.client_token) headers["Client-Token"] = config.client_token;

    let processed = 0;

    for (const msg of messages) {
      // Mark as processing
      await supabase.from("scheduled_messages").update({ status: "processing" }).eq("id", msg.id);

      try {
        let endpoint: string;
        let body: Record<string, unknown>;
        const recipient = msg.recipient;

        switch (msg.content_type) {
          case "image":
            endpoint = "/send-image";
            body = { phone: recipient, image: msg.media_url, caption: msg.content };
            break;
          case "document": {
            const ext = (msg.media_filename || "file").split(".").pop() || "pdf";
            endpoint = `/send-document/${ext}`;
            body = { phone: recipient, document: msg.media_url, fileName: msg.media_filename, caption: msg.content };
            break;
          }
          case "audio":
            endpoint = "/send-audio";
            body = { phone: recipient, audio: msg.media_url };
            break;
          case "video":
            endpoint = "/send-video";
            body = { phone: recipient, video: msg.media_url, caption: msg.content };
            break;
          case "contact": {
            // Contact: content has "name|phone" format
            const [cName, cPhone] = (msg.content || "").split("|");
            endpoint = "/send-contact";
            body = { phone: recipient, contactName: cName || "", contactPhone: cPhone || "" };
            break;
          }
          default:
            endpoint = "/send-text";
            body = { phone: recipient, message: msg.content };
        }

        const res = await fetch(`${baseUrl}${endpoint}`, { method: "POST", headers, body: JSON.stringify(body) });
        const result = await res.json();

        if (!res.ok) throw new Error(result.error || `Z-API ${res.status}`);

        // Mark as sent
        await supabase.from("scheduled_messages").update({
          status: "sent",
          sent_at: new Date().toISOString(),
        }).eq("id", msg.id);

        // Log success
        await supabase.from("scheduled_message_logs").insert({
          scheduled_message_id: msg.id,
          status: "sent",
        });

        // Handle recurrence
        if (msg.is_recurring) {
          const nextDate = calculateNextSchedule(msg);
          if (nextDate) {
            await supabase.from("scheduled_messages").insert({
              recipient: msg.recipient,
              contact_name: msg.contact_name,
              chat_jid: msg.chat_jid,
              content_type: msg.content_type,
              content: msg.content,
              media_url: msg.media_url,
              media_filename: msg.media_filename,
              scheduled_at: nextDate,
              is_recurring: true,
              recurrence_pattern: msg.recurrence_pattern,
              recurrence_interval: msg.recurrence_interval,
              recurrence_days: msg.recurrence_days,
              recurrence_end_date: msg.recurrence_end_date,
            });
          }
        }

        processed++;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await supabase.from("scheduled_messages").update({
          status: "failed",
          error: errMsg,
        }).eq("id", msg.id);

        await supabase.from("scheduled_message_logs").insert({
          scheduled_message_id: msg.id,
          status: "failed",
          error_message: errMsg,
        });
      }
    }

    return NextResponse.json({ status: "ok", processed });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("send-scheduled error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
