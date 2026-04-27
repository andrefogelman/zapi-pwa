import OpenAI from "openai";
import { env } from "./env";

let _openai: OpenAI | null = null;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return _openai;
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

  const model = config.model ?? "whisper-1";

  const response = await getOpenAI().audio.transcriptions.create({
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

export async function generateImage(prompt: string): Promise<{ base64: string; mimeType: string }> {
  const response = await getOpenAI().images.generate({
    model: "gpt-image-1",
    prompt,
    size: "1024x1024",
    n: 1,
  });
  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image returned from OpenAI");
  return { base64: b64, mimeType: "image/png" };
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
  const response = await getOpenAI().chat.completions.create({
    model: config.model ?? "gpt-4.1-mini",
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
