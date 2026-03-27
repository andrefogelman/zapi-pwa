import OpenAI from "openai";
import { env } from "./env";
import { NEURA_SYSTEM_PROMPT, NEURA_MODEL, NEURA_TEMPERATURE, NEURA_TOP_P } from "./neura-prompt";

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  const arrayBuffer = audioBuffer.buffer.slice(
    audioBuffer.byteOffset,
    audioBuffer.byteOffset + audioBuffer.byteLength
  ) as ArrayBuffer;
  const blob = new Blob([arrayBuffer], { type: "audio/ogg" });
  const file = new File([blob], "audio.ogg", { type: "audio/ogg" });

  const response = await openai.audio.transcriptions.create({
    model: "whisper-1",
    file,
  });

  return response.text;
}

export async function summarizeText(text: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: NEURA_MODEL,
    temperature: NEURA_TEMPERATURE,
    top_p: NEURA_TOP_P,
    messages: [
      { role: "system", content: NEURA_SYSTEM_PROMPT },
      { role: "user", content: `Resumir o texto ${text}` },
    ],
  });

  return response.choices[0]?.message?.content ?? "";
}
