import { getSupabaseServer, getGroupAuth } from "./supabase-server";

interface MessageData {
  groupId: string;
  groupName: string;
  sender: string;
  senderName: string;
  messageType: "text" | "audio_transcription";
  content: string;
}

export async function saveMonitoredMessage(data: MessageData): Promise<void> {
  // Check if group has monitor_daily enabled
  const auth = await getGroupAuth(data.groupId);
  if (!auth.authorized || !auth.monitor_daily) return;

  const supabase = getSupabaseServer();
  const { error } = await supabase.from("group_messages").insert({
    group_id: data.groupId,
    group_name: data.groupName,
    sender: data.sender,
    sender_name: data.senderName,
    message_type: data.messageType,
    content: data.content,
  });

  if (error) {
    console.error("[monitor] Failed to save message:", error.message);
  }
}

export interface DailyReport {
  groupId: string;
  groupName: string;
  messageCount: number;
  messages: Array<{
    sender_name: string;
    message_type: string;
    content: string;
    created_at: string;
  }>;
}

export async function getDailyReports(): Promise<DailyReport[]> {
  const supabase = getSupabaseServer();

  // Get groups with monitor_daily enabled
  const { data: groups } = await supabase
    .from("grupos_autorizados")
    .select("group_id, subject")
    .eq("monitor_daily", true);

  if (!groups || groups.length === 0) return [];

  // Get today's messages (UTC-3 Brazil timezone)
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(todayStart.getHours() - 3); // adjust to BRT
  todayStart.setHours(0, 0, 0, 0);
  todayStart.setHours(todayStart.getHours() + 3); // back to UTC

  const reports: DailyReport[] = [];

  for (const group of groups) {
    const { data: messages } = await supabase
      .from("group_messages")
      .select("sender_name, message_type, content, created_at")
      .eq("group_id", group.group_id)
      .gte("created_at", todayStart.toISOString())
      .order("created_at", { ascending: true });

    if (messages && messages.length > 0) {
      reports.push({
        groupId: group.group_id,
        groupName: group.subject,
        messageCount: messages.length,
        messages,
      });
    }
  }

  return reports;
}

export async function cleanupOldMessages(daysToKeep: number = 7): Promise<void> {
  const supabase = getSupabaseServer();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysToKeep);

  await supabase
    .from("group_messages")
    .delete()
    .lt("created_at", cutoff.toISOString());
}
