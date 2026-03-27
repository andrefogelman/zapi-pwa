import OpenAI from "openai";
import { env } from "./env";
import { getZapiConfig } from "./config";
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
  const config = await getZapiConfig();

  // Use config from Supabase if available, otherwise fall back to hardcoded
  const prompt = config.neura_prompt || NEURA_SYSTEM_PROMPT;
  const model = config.neura_model || NEURA_MODEL;
  const temperature = config.neura_temperature ?? NEURA_TEMPERATURE;
  const topP = config.neura_top_p ?? NEURA_TOP_P;

  const response = await openai.chat.completions.create({
    model,
    temperature,
    top_p: topP,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: `Resumir o texto ${text}` },
    ],
  });

  return response.choices[0]?.message?.content ?? "";
}
