/**
 * Appends the user's customized footer to a transcribed message.
 * Used when the reply is sent back to WhatsApp.
 */
export function formatReply(transcribedText: string, footer: string): string {
  const trimmed = transcribedText.replace(/\s+$/, "");
  if (!footer) return trimmed;
  return `${trimmed}\n\n${footer}`;
}
