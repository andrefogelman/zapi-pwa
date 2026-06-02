import OpenAI from "openai";
import { env } from "./env";

// Groq — OpenAI-compatible client for Whisper transcription + chat summaries
// (~10x cheaper than OpenAI). Reuses the OpenAI SDK class, re-pointed at Groq.
let _groq: OpenAI | null = null;
function getGroq() {
  if (!_groq) _groq = new OpenAI({ apiKey: env.GROQ_API_KEY, baseURL: "https://api.groq.com/openai/v1" });
  return _groq;
}

export interface TranscribeConfig {
  model?: string;
  prompt?: string;
  temperature?: number;
  language?: string;
}

function isWhisperHallucination(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  // Same character repeated 10+ times (e.g. "****...", "லலலலல...")
  if (/^(.)\1{9,}$/.test(t)) return true;
  // >85% the same word repeated (e.g. "Allāh Allāh Allāh...")
  const words = t.split(/\s+/);
  if (words.length >= 10) {
    const freq = new Map<string, number>();
    for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
    const maxCount = Math.max(...freq.values());
    if (maxCount / words.length > 0.85) return true;
  }
  return false;
}

export async function transcribeAudio(
  audio: ArrayBuffer,
  config: TranscribeConfig = {}
): Promise<string> {
  const file = new File([audio], "audio.ogg", { type: "audio/ogg" });

  // Groq model. config.model (per-instance override) must be a Groq-supported
  // whisper model; default is the cheap/fast turbo variant.
  const model = config.model ?? "whisper-large-v3-turbo";

  const response = await getGroq().audio.transcriptions.create({
    file,
    model,
    prompt: config.prompt,
    temperature: config.temperature,
    language: config.language ?? "pt",
  });

  if (isWhisperHallucination(response.text)) {
    throw new Error("whisper hallucination detected");
  }

  return response.text;
}

export interface SummarizeConfig {
  model?: string;
  prompt?: string;
  temperature?: number;
}

export async function summarizeText(
  text: string,
  config: SummarizeConfig = {},
): Promise<string> {
  const response = await getGroq().chat.completions.create({
    model: config.model ?? "llama-3.3-70b-versatile",
    temperature: config.temperature ?? 0.3,
    messages: [
      {
        role: "system",
        content:
          config.prompt ??
          "Você é um assistente que resume transcrições de áudio do WhatsApp. Resuma de forma concisa em português, mantendo os pontos principais.",
      },
      { role: "user", content: `Resuma este áudio transcrito:\n\n${text}` },
    ],
  });

  return response.choices[0]?.message?.content ?? "";
}
