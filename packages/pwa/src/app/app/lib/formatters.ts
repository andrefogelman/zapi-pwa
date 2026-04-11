export function formatChatName(jid: string, name: string | null): string {
  if (name && name !== jid && !name.includes("@")) return name;
  const phone = jid.split("@")[0];
  if (/^\d{12,13}$/.test(phone) && phone.startsWith("55")) {
    const ddd = phone.slice(2, 4);
    const num = phone.slice(4);
    if (num.length === 9) return `(${ddd}) ${num.slice(0, 5)}-${num.slice(5)}`;
    if (num.length === 8) return `(${ddd}) ${num.slice(0, 4)}-${num.slice(4)}`;
  }
  if (/^\d+$/.test(phone)) return `+${phone}`;
  return phone;
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

export function getInitial(name: string): string {
  const clean = name.replace(/[^a-zA-ZÀ-ÿ0-9]/g, "");
  return clean.charAt(0).toUpperCase() || "?";
}

// DiceBear deterministic avatars. A JID always produces the same avatar,
// giving contacts a consistent visual identity while wacli lacks real
// profile pic support. Groups get a distinct style.
export function generateAvatarUrl(jid: string, isGroup: boolean): string {
  const seed = encodeURIComponent(jid);
  const style = isGroup ? "shapes" : "initials";
  return `https://api.dicebear.com/7.x/${style}/svg?seed=${seed}&backgroundColor=00a884,018a72,25d366,128c7e&radius=50`;
}

export type ChatTab = "all" | "dms" | "groups" | "channels";
export function getChatTab(kind: string, jid: string): ChatTab {
  if (jid.includes("@newsletter") || jid === "status@broadcast") return "channels";
  if (kind === "group") return "groups";
  if (kind === "dm") return "dms";
  if (jid.includes("@s.whatsapp.net") || jid.includes("@lid")) return "dms";
  if (jid.includes("@g.us")) return "groups";
  return "dms";
}
