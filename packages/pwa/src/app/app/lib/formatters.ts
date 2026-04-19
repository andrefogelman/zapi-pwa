export function formatChatName(jid: string, name: string | null): string {
  if (name && name !== jid && !name.includes("@")) return name;
  const [local, server] = jid.split("@");
  if (server === "lid" || server === "hosted.lid") return "Contato";
  // Legacy group JID local-part: `<phone>-<timestamp>` (pre-@g.us era).
  if (/^\d+-\d+$/.test(local)) return "Grupo";
  const phone = local;
  // LID heuristic: 15+ contiguous digits exceed any real E.164 phone.
  // Backend should mark these as @lid, but this is a display safety net.
  if (/^\d{15,}$/.test(phone)) return "Contato";
  if (/^\d{12,13}$/.test(phone) && phone.startsWith("55")) {
    const ddd = phone.slice(2, 4);
    const num = phone.slice(4);
    if (num.length === 9) return `(${ddd}) ${num.slice(0, 5)}-${num.slice(5)}`;
    if (num.length === 8) return `(${ddd}) ${num.slice(0, 4)}-${num.slice(4)}`;
  }
  if (/^\d+$/.test(phone)) return `+${phone}`;
  return phone;
}

/**
 * Display a sender's name in group messages. Falls back through:
 *   1. push_name / full_name (`name` argument, if human-looking),
 *   2. formatted phone from JID,
 *   3. "Contato" for LID-only senders (raw LID is not user-friendly).
 *
 * Never returns a raw `@lid` or `@s.whatsapp.net` string.
 */
export function formatSenderName(name: string | null | undefined, jid: string | null | undefined): string {
  if (name && !name.includes("@") && name !== jid) return name;
  if (!jid) return "Contato";
  return formatChatName(jid, null);
}

export function formatChatTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts < 1e12 ? ts * 1000 : ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.floor((today.getTime() - msgDay.getTime()) / 86400000);
  if (diff === 0) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (diff === 1) return "Ontem";
  if (diff < 7) return d.toLocaleDateString("pt-BR", { weekday: "short" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export function formatMsgTime(ts: number): string {
  const d = new Date(ts < 1e12 ? ts * 1000 : ts);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function formatDayLabel(ts: number): string {
  const d = new Date(ts < 1e12 ? ts * 1000 : ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.floor((today.getTime() - msgDay.getTime()) / 86400000);
  if (diff === 0) return "HOJE";
  if (diff === 1) return "ONTEM";
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" }).toUpperCase();
}

export function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
  }
  const clean = name.replace(/[^a-zA-ZÀ-ÿ0-9]/g, "");
  return clean.charAt(0).toUpperCase() || "?";
}

// Deterministic color from JID for avatar backgrounds.
const AVATAR_COLORS = [
  "#00a884", "#018a72", "#25d366", "#128c7e",
  "#7c3aed", "#2563eb", "#db2777", "#ea580c",
  "#0891b2", "#4f46e5", "#059669", "#d97706",
];

export function avatarColor(jid: string): string {
  let hash = 0;
  for (let i = 0; i < jid.length; i++) hash = ((hash << 5) - hash + jid.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}


export type ChatTab = "all" | "dms" | "groups" | "channels";
export function getChatTab(kind: string, jid: string): ChatTab {
  if (kind === "channel" || jid.includes("@newsletter") || jid === "status@broadcast") return "channels";
  if (kind === "group" || jid.includes("@g.us")) return "groups";
  if (jid.includes("@s.whatsapp.net") || jid.includes("@lid")) return "dms";
  if (kind === "dm") return "dms";
  return "dms";
}
