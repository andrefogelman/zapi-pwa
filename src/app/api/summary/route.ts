import { NextRequest, NextResponse } from "next/server";
import { fetchMessages } from "@/lib/wacli-api";
import { getZapiConfig } from "@/lib/config";
import { sendMessage } from "@/lib/zapi";
import OpenAI from "openai";
import { env } from "@/lib/env";

export const maxDuration = 60;

const REPORT_PHONE = "5511993604399";
const MAX_CHARS = 100_000;

function resolvePeriod(period?: string): { after: string; before: string } {
  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const today = brt.toISOString().split("T")[0];
  const daysAgo = (n: number) => {
    const d = new Date(brt);
    d.setDate(d.getDate() - n);
    return d.toISOString().split("T")[0];
  };

  switch (period) {
    case "hoje": return { after: today, before: "" };
    case "ontem": return { after: daysAgo(1), before: today };
    case "última semana": case "últimos 7 dias": return { after: daysAgo(7), before: "" };
    case "último mês": case "últimos 30 dias": return { after: daysAgo(30), before: "" };
    case "últimos 3 dias": return { after: daysAgo(3), before: "" };
    default: return { after: daysAgo(7), before: "" };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { groupIds, period, query, sendWhatsApp } = body as {
      groupIds: string[];
      period?: string;
      after?: string;
      before?: string;
      query?: string;
      sendWhatsApp?: boolean;
    };

    if (!groupIds || groupIds.length === 0) {
      return NextResponse.json({ error: "groupIds required" }, { status: 400 });
    }

    const resolved = (body.after && body.before)
      ? { after: body.after, before: body.before }
      : resolvePeriod(period);

    const config = await getZapiConfig();
    const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

    const summaries: string[] = [];
    const groupStats: Array<{ name: string; messageCount: number }> = [];
    let partial = false;

    for (const groupId of groupIds) {
      let data;
      try {
        data = await fetchMessages({
          chat: groupId,
          after: resolved.after,
          before: resolved.before || undefined,
          query,
          limit: 500,
        });
      } catch {
        summaries.push(`## ${groupId}\n\n_Erro ao buscar mensagens deste grupo._`);
        continue;
      }

      if (data.messages.length === 0) {
        summaries.push(`## ${groupId}\n\n_Nenhuma mensagem no período._`);
        groupStats.push({ name: groupId, messageCount: 0 });
        continue;
      }

      const groupName = data.messages[0]?.chatName || groupId;

      const conversationLog = data.messages
        .map((m) => {
          const time = m.timestamp ? new Date(m.timestamp).toISOString().substring(11, 16) : "";
          const typeTag = m.type && m.type !== "text" && m.type !== "" ? ` [${m.type}]` : "";
          return `[${time}] ${m.sender}${typeTag}: ${m.text}`;
        })
        .join("\n");

      let logToSummarize = conversationLog;
      if (conversationLog.length > MAX_CHARS) {
        logToSummarize = conversationLog.slice(-MAX_CHARS);
        partial = true;
      }

      const prompt = `Analise as conversas abaixo do grupo "${groupName}" no período de ${resolved.after} a ${resolved.before || "agora"}.

Gere um resumo estruturado em português do Brasil com:
1. **Principais tópicos discutidos** — organizados por tema
2. **Decisões tomadas** — o que foi decidido e por quem
3. **Tarefas e pendências** — o que ficou para fazer
4. **Informações importantes** — dados, datas, valores mencionados

Formato: markdown com headers e bullet points.
Se não houver mensagens relevantes num tópico, omita-o.

Conversas:
${logToSummarize}`;

      const completion = await openai.chat.completions.create({
        model: config.neura_model || "gpt-4o",
        temperature: config.neura_temperature ?? 0.5,
        messages: [
          { role: "system", content: "Você é um assistente que resume conversas de grupos do WhatsApp em português do Brasil." },
          { role: "user", content: prompt },
        ],
      });

      const summary = completion.choices[0]?.message?.content || "_Não foi possível gerar resumo._";
      summaries.push(`## ${groupName}\n\n${summary}`);
      groupStats.push({ name: groupName, messageCount: data.messages.length });
    }

    const fullSummary = summaries.join("\n\n---\n\n");

    if (sendWhatsApp) {
      const waMessage = partial
        ? `${fullSummary}\n\n⚠️ _Resumo parcial — período muito grande_`
        : fullSummary;
      await sendMessage(REPORT_PHONE, waMessage);
    }

    return NextResponse.json({
      summary: fullSummary,
      groups: groupStats,
      period: resolved,
      partial,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Summary error:", msg);
    return NextResponse.json({ error: "internal_error", message: msg }, { status: 500 });
  }
}
