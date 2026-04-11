export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";
import OpenAI from "openai";
import { env } from "@/lib/env";

const WACLAW_URL = process.env.WACLAW_URL || "https://worker5.taile4c10f.ts.net";
const WACLAW_API_KEY = process.env.WACLAW_API_KEY || "waclaw-dev-key";
const MAX_CHARS = 100_000;

type WaclawMessage = {
  id: string;
  senderName: string | null;
  text: string | null;
  timestamp: number;
  type: string;
  mediaCaption: string | null;
  fromMe: boolean;
};

// POST /api/summary
// body: { sessionId, chatJid, period, sendBackToChat? }
// period: "hoje" | "24h" | "7d" | "30d" | "3d"
export async function POST(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { sessionId, chatJid, period, sendBackToChat } = body;
  if (!sessionId || !chatJid || !period) {
    return Response.json(
      { error: "sessionId, chatJid, and period required" },
      { status: 400 }
    );
  }

  // Verify the user owns an instance bound to this session
  const supabase = getSupabaseServer();
  const { data: instance } = await supabase
    .from("instances")
    .select("id")
    .eq("user_id", user.id)
    .eq("waclaw_session_id", sessionId)
    .maybeSingle();
  if (!instance) {
    return Response.json({ error: "Session not accessible" }, { status: 403 });
  }

  // Fetch a generous window of messages and filter by period client-side.
  // The waclaw messages endpoint doesn't yet support date-range queries, so
  // we pull the last N and drop anything outside the period.
  const limit = period === "30d" ? 1000 : period === "7d" ? 500 : 200;
  const cutoffMs = resolveCutoff(period);

  const res = await fetch(
    `${WACLAW_URL}/sessions/${sessionId}/messages/${encodeURIComponent(chatJid)}?limit=${limit}`,
    { headers: { "X-API-Key": WACLAW_API_KEY } }
  );
  if (!res.ok) {
    return Response.json(
      { error: `Failed to fetch messages: HTTP ${res.status}` },
      { status: 502 }
    );
  }
  const messages = (await res.json()) as WaclawMessage[];
  if (!Array.isArray(messages)) {
    return Response.json({ error: "Invalid messages response" }, { status: 502 });
  }

  const inPeriod = messages.filter((m) => {
    const tsMs = m.timestamp < 1e12 ? m.timestamp * 1000 : m.timestamp;
    return tsMs >= cutoffMs;
  });

  if (inPeriod.length === 0) {
    return Response.json({
      summary: "_Nenhuma mensagem no período selecionado._",
      messageCount: 0,
      period,
    });
  }

  // Build the conversation log
  const conversationLog = inPeriod
    .map((m) => {
      const tsMs = m.timestamp < 1e12 ? m.timestamp * 1000 : m.timestamp;
      const time = new Date(tsMs).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Sao_Paulo",
      });
      const sender = m.fromMe ? "Você" : m.senderName || "Desconhecido";
      const typeTag =
        m.type && m.type !== "text" ? ` [${m.type}]` : "";
      const content = m.text || m.mediaCaption || "";
      return `[${time}] ${sender}${typeTag}: ${content}`;
    })
    .join("\n");

  let logToSummarize = conversationLog;
  let partial = false;
  if (conversationLog.length > MAX_CHARS) {
    logToSummarize = conversationLog.slice(-MAX_CHARS);
    partial = true;
  }

  const periodLabel = describePeriod(period);
  const prompt = `Analise a conversa abaixo do período: ${periodLabel}.

Gere um resumo estruturado em português do Brasil com:
1. **Principais tópicos** — organizados por tema
2. **Decisões tomadas** — o que foi decidido e por quem
3. **Tarefas e pendências** — o que ficou para fazer, quem ficou responsável
4. **Informações importantes** — datas, valores, nomes, números mencionados

Formato: markdown com headers e bullet points.
Se não houver conteúdo relevante numa seção, omita-a.
Se a conversa tiver pouco conteúdo substancial, faça um resumo curto de 2-3 parágrafos.

Conversa:
${logToSummarize}`;

  let summary: string;
  try {
    const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "Você é um assistente que resume conversas do WhatsApp em português do Brasil de forma clara e objetiva.",
        },
        { role: "user", content: prompt },
      ],
    });
    summary = completion.choices[0]?.message?.content || "_Não foi possível gerar resumo._";
  } catch (err) {
    const message = err instanceof Error ? err.message : "OpenAI failed";
    return Response.json({ error: message }, { status: 500 });
  }

  // Optionally send the summary back to the same chat as a regular message
  if (sendBackToChat) {
    const suffix = partial ? "\n\n⚠️ _Resumo parcial — conversa muito grande_" : "";
    const waMessage = `📋 *Resumo — ${periodLabel}*\n\n${summary}${suffix}`;
    await fetch(`${WACLAW_URL}/sessions/${sessionId}/send`, {
      method: "POST",
      headers: {
        "X-API-Key": WACLAW_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: chatJid, message: waMessage }),
    }).catch(() => {});
  }

  return Response.json({
    summary,
    messageCount: inPeriod.length,
    period,
    partial,
  });
}

function resolveCutoff(period: string): number {
  const now = new Date();
  // Convert to BRT for "hoje"
  switch (period) {
    case "hoje": {
      const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
      const y = brt.getUTCFullYear();
      const m = brt.getUTCMonth();
      const d = brt.getUTCDate();
      // Midnight BRT today in UTC ms
      return Date.UTC(y, m, d) + 3 * 60 * 60 * 1000;
    }
    case "24h":
      return now.getTime() - 24 * 60 * 60 * 1000;
    case "3d":
      return now.getTime() - 3 * 24 * 60 * 60 * 1000;
    case "7d":
      return now.getTime() - 7 * 24 * 60 * 60 * 1000;
    case "30d":
      return now.getTime() - 30 * 24 * 60 * 60 * 1000;
    default:
      return now.getTime() - 7 * 24 * 60 * 60 * 1000;
  }
}

function describePeriod(period: string): string {
  switch (period) {
    case "hoje":
      return "hoje";
    case "24h":
      return "últimas 24 horas";
    case "3d":
      return "últimos 3 dias";
    case "7d":
      return "últimos 7 dias";
    case "30d":
      return "últimos 30 dias";
    default:
      return period;
  }
}
