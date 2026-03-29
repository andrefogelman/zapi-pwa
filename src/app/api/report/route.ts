import { NextResponse } from "next/server";
import { getDailyReports, cleanupOldMessages } from "@/lib/monitor";
import { summarizeText } from "@/lib/openai";
import { sendMessage } from "@/lib/zapi";

export const maxDuration = 60;

const REPORT_PHONE = "5511993604399";

function formatTime(isoDate: string): string {
  const d = new Date(isoDate);
  // Convert to BRT (UTC-3)
  d.setHours(d.getHours() - 3);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export async function GET() {
  try {
    const reports = await getDailyReports();

    if (reports.length === 0) {
      return NextResponse.json({ status: "no_reports", message: "Nenhum grupo monitorado com mensagens hoje" });
    }

    let totalGroups = 0;

    for (const report of reports) {
      // Build conversation log
      const conversationLog = report.messages
        .map((m) => {
          const time = formatTime(m.created_at);
          const type = m.message_type === "audio_transcription" ? " [audio]" : "";
          return `[${time}] ${m.sender_name}${type}: ${m.content}`;
        })
        .join("\n");

      // Summarize with AI
      const summaryPrompt = `Resuma as conversas abaixo do grupo "${report.groupName}" de hoje.
Destaque: decisões tomadas, tarefas definidas, informações importantes, e pendências.
Formato: bullet points organizados por tema.

Conversas:
${conversationLog}`;

      const summary = await summarizeText(summaryPrompt);

      // Build WhatsApp message
      const message = `📋 *Report Diário: ${report.groupName}*\n` +
        `📊 ${report.messageCount} mensagens hoje\n\n` +
        `*Resumo:*\n${summary}`;

      await sendMessage(REPORT_PHONE, message);
      totalGroups++;
    }

    // Cleanup old messages (keep 7 days)
    await cleanupOldMessages(7);

    return NextResponse.json({
      status: "ok",
      reports: totalGroups,
      groups: reports.map((r) => ({ name: r.groupName, messages: r.messageCount })),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Report error:", msg);
    return NextResponse.json({ status: "error", message: msg }, { status: 500 });
  }
}
