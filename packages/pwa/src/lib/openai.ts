import OpenAI from "openai";
import { env } from "./env";

let _openai: OpenAI | null = null;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return _openai;
}

export async function transcribeAudio(audioBuffer: ArrayBuffer): Promise<string> {
  const blob = new Blob([audioBuffer], { type: "audio/ogg" });
  const file = new File([blob], "audio.ogg", { type: "audio/ogg" });

  const response = await getOpenAI().audio.transcriptions.create({
    model: "whisper-1",
    file,
  });

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

export async function summarizeText(text: string): Promise<string> {
  const response = await getOpenAI().chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content: "Você é um assistente que resume transcrições de áudio do WhatsApp. Resuma de forma concisa em português, mantendo os pontos principais.",
      },
      { role: "user", content: `Resuma este áudio transcrito:\n\n${text}` },
    ],
  });

  return response.choices[0]?.message?.content ?? "";
}
