"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/lib/use-auth";

interface Props {
  open: boolean;
  onClose: () => void;
  onSend: (file: File, caption?: string) => Promise<void>;
}

interface PickedContact {
  name: string;
  phones: string[];
  emails: string[];
  organization?: string;
}

// Web Contact Picker API (Android Chrome only)
type WebContact = { name?: string[]; tel?: string[]; email?: string[] };
type WebContactPicker = {
  select: (props: string[], options?: { multiple?: boolean }) => Promise<WebContact[]>;
};
type WebContactNav = Navigator & { contacts?: WebContactPicker };

export function ContactPickerModal({ open, onClose, onSend }: Props) {
  const { session, signInWithGoogle } = useAuth();
  const [tab, setTab] = useState<"google" | "manual">("google");
  const [googleContacts, setGoogleContacts] = useState<PickedContact[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);

  // Manual entry form
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [manualOrg, setManualOrg] = useState("");

  // Device Web Contact Picker support
  const deviceSupported = typeof navigator !== "undefined" && "contacts" in navigator;

  useEffect(() => {
    if (!open) return;
    // Auto-fetch Google contacts if we have a provider token and no data yet
    const providerToken = (session as unknown as { provider_token?: string })?.provider_token;
    if (tab === "google" && providerToken && !googleContacts && !loading) {
      fetchGoogleContacts(providerToken);
    }
  }, [open, tab, session, googleContacts, loading]);

  useEffect(() => {
    if (!open) {
      // Reset state when closed
      setError(null);
      setSearch("");
      setManualName("");
      setManualPhone("");
      setManualEmail("");
      setManualOrg("");
    }
  }, [open]);

  async function fetchGoogleContacts(token: string) {
    setLoading(true);
    setError(null);
    try {
      // First check what scopes this token actually has
      const info = await fetch(
        `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${token}`
      );
      if (info.ok) {
        const infoData = await info.json();
        const scopes = (infoData.scope || "").split(" ");
        if (!scopes.includes("https://www.googleapis.com/auth/contacts.readonly")) {
          setError(
            "Este token não tem permissão pra ler contatos. Clique em 'Reconectar com Google' pra autorizar."
          );
          setGoogleContacts(null);
          return;
        }
      }

      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      const all: PickedContact[] = [];

      // 1) Paginate through all "My Contacts" (people/me/connections)
      let pageToken1: string | null = null;
      while (true) {
        const url1: string =
          "https://people.googleapis.com/v1/people/me/connections" +
          "?personFields=names,phoneNumbers,emailAddresses,organizations" +
          "&pageSize=1000" +
          (pageToken1 ? `&pageToken=${encodeURIComponent(pageToken1)}` : "");
        const res1: Response = await fetch(url1, { headers });
        if (res1.status === 401) {
          setError("Token do Google expirou. Reconecte para acessar contatos.");
          setGoogleContacts(null);
          return;
        }
        if (res1.status === 403) {
          let detail = "";
          try {
            const errData = await res1.json();
            detail = errData?.error?.message || "";
          } catch {}
          setError(
            `HTTP 403${detail ? `: ${detail}` : ""}. ` +
            "Verifique o scope 'contacts.readonly' no OAuth consent screen, ou clique em 'Reconectar com Google'."
          );
          setGoogleContacts(null);
          return;
        }
        if (!res1.ok) {
          setError(`Falha ao carregar contatos (HTTP ${res1.status})`);
          return;
        }
        const data1: { connections?: Array<Record<string, unknown>>; nextPageToken?: string } = await res1.json();
        for (const p of data1.connections || []) {
          const parsed = parseConnection(p);
          if (parsed) all.push(parsed);
        }
        if (!data1.nextPageToken) break;
        pageToken1 = data1.nextPageToken;
      }

      // 2) Paginate through "Other contacts" (people you've interacted with)
      let pageToken2: string | null = null;
      while (true) {
        const url2: string =
          "https://people.googleapis.com/v1/otherContacts" +
          "?readMask=names,phoneNumbers,emailAddresses" +
          "&pageSize=1000" +
          (pageToken2 ? `&pageToken=${encodeURIComponent(pageToken2)}` : "");
        const res2: Response = await fetch(url2, { headers });
        if (!res2.ok) break; // otherContacts is optional; don't fail the whole flow
        const data2: { otherContacts?: Array<Record<string, unknown>>; nextPageToken?: string } = await res2.json();
        for (const p of data2.otherContacts || []) {
          const parsed = parseConnection(p);
          if (parsed) all.push(parsed);
        }
        if (!data2.nextPageToken) break;
        pageToken2 = data2.nextPageToken;
      }

      // Dedupe by first phone number (or name if no phone) and sort
      const seen = new Set<string>();
      const deduped: PickedContact[] = [];
      for (const c of all) {
        const key = (c.phones[0] || c.name).replace(/\D/g, "") || c.name;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(c);
      }
      deduped.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      setGoogleContacts(deduped);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function pickFromDevice() {
    if (!deviceSupported) return;
    setError(null);
    try {
      const nav = navigator as WebContactNav;
      const result = await nav.contacts!.select(["name", "tel", "email"], { multiple: false });
      if (result.length === 0) return;
      const c = result[0];
      await sendContact({
        name: c.name?.[0] || "",
        phones: c.tel || [],
        emails: c.email || [],
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function sendContact(contact: PickedContact) {
    if (sending || !contact.name || contact.phones.length === 0) return;
    setSending(true);
    try {
      const vcard = buildVCard(contact);
      const blob = new Blob([vcard], { type: "text/vcard" });
      const safeName = contact.name.replace(/[^a-zA-Z0-9 _-]/g, "").replace(/\s+/g, "_") || "contato";
      const file = new File([blob], `${safeName}.vcf`, { type: "text/vcard" });
      await onSend(file);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setSending(false);
    }
  }

  function sendManual() {
    sendContact({
      name: manualName.trim(),
      phones: manualPhone.trim() ? [manualPhone.trim()] : [],
      emails: manualEmail.trim() ? [manualEmail.trim()] : [],
      organization: manualOrg.trim() || undefined,
    });
  }

  const filteredContacts = useMemo(() => {
    if (!googleContacts) return [];
    const raw = search.trim();
    if (!raw) return googleContacts;
    const q = normalizeForSearch(raw);
    const qDigits = raw.replace(/\D/g, "");
    return googleContacts.filter((c) => {
      if (normalizeForSearch(c.name).includes(q)) return true;
      if (c.organization && normalizeForSearch(c.organization).includes(q)) return true;
      if (qDigits && c.phones.some((p) => p.replace(/\D/g, "").includes(qDigits))) return true;
      if (c.emails.some((e) => normalizeForSearch(e).includes(q))) return true;
      return false;
    });
  }, [googleContacts, search]);

  if (!open) return null;

  const providerToken = (session as unknown as { provider_token?: string })?.provider_token;

  return (
    <div className="wa-modal-overlay" onClick={onClose}>
      <div className="wa-modal wa-modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="wa-modal-header">
          <div className="wa-modal-title">Escolher contato</div>
          <button className="wa-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="wa-tabs wa-modal-tabs">
          <button
            className={`wa-tab ${tab === "google" ? "active" : ""}`}
            onClick={() => setTab("google")}
          >
            Google
          </button>
          <button
            className={`wa-tab ${tab === "manual" ? "active" : ""}`}
            onClick={() => setTab("manual")}
          >
            Manual
          </button>
        </div>

        <div className="wa-modal-body">
          {tab === "google" && (
            <>
              {!providerToken ? (
                <div className="wa-contact-empty">
                  <p>Para acessar seus contatos do Google, reconecte com o escopo de contatos.</p>
                  <button className="wa-modal-primary" onClick={() => signInWithGoogle()}>
                    Reconectar com Google
                  </button>
                </div>
              ) : loading ? (
                <div className="wa-contact-empty">Carregando contatos...</div>
              ) : error ? (
                <div className="wa-contact-empty">
                  <div className="wa-modal-error">{error}</div>
                  <button className="wa-modal-primary" onClick={() => signInWithGoogle()}>
                    Reconectar com Google
                  </button>
                </div>
              ) : googleContacts && googleContacts.length === 0 ? (
                <div className="wa-contact-empty">Nenhum contato encontrado na conta Google.</div>
              ) : (
                <>
                  <input
                    className="wa-modal-search"
                    placeholder={`Buscar em ${googleContacts?.length || 0} contatos...`}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search && (
                    <div className="wa-search-count">
                      {filteredContacts.length} resultado{filteredContacts.length === 1 ? "" : "s"}
                    </div>
                  )}
                  <div className="wa-contact-list">
                    {filteredContacts.map((c, i) => (
                      <button
                        key={`${c.name}-${i}`}
                        className="wa-contact-list-item"
                        onClick={() => sendContact(c)}
                        disabled={sending}
                      >
                        <div className="wa-contact-list-avatar">
                          {c.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="wa-contact-list-info">
                          <div className="wa-contact-list-name">{c.name}</div>
                          <div className="wa-contact-list-sub">{c.phones[0]}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {tab === "manual" && (
            <div className="wa-manual-form">
              {deviceSupported && (
                <button className="wa-modal-secondary wa-device-btn" onClick={pickFromDevice}>
                  📱 Escolher do dispositivo
                </button>
              )}
              <label className="wa-modal-label">Nome *</label>
              <input
                className="wa-modal-input"
                placeholder="Nome completo"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
              />
              <label className="wa-modal-label">Telefone *</label>
              <input
                className="wa-modal-input"
                placeholder="+55 11 99999-9999"
                value={manualPhone}
                onChange={(e) => setManualPhone(e.target.value)}
              />
              <label className="wa-modal-label">Email</label>
              <input
                className="wa-modal-input"
                placeholder="email@exemplo.com"
                value={manualEmail}
                onChange={(e) => setManualEmail(e.target.value)}
              />
              <label className="wa-modal-label">Empresa</label>
              <input
                className="wa-modal-input"
                placeholder="Empresa (opcional)"
                value={manualOrg}
                onChange={(e) => setManualOrg(e.target.value)}
              />
              {error && <div className="wa-modal-error">{error}</div>}
            </div>
          )}
        </div>

        {tab === "manual" && (
          <div className="wa-modal-footer">
            <button
              className="wa-modal-primary"
              onClick={sendManual}
              disabled={sending || !manualName.trim() || !manualPhone.trim()}
            >
              {sending ? "Enviando..." : "Enviar contato"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Normalize for accent- and case-insensitive search
function normalizeForSearch(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function parseConnection(p: Record<string, unknown>): PickedContact | null {
  const names = p.names as Array<{ displayName?: string; unstructuredName?: string }> | undefined;
  const phones = p.phoneNumbers as Array<{ value?: string; canonicalForm?: string }> | undefined;
  const emails = p.emailAddresses as Array<{ value?: string }> | undefined;
  const orgs = p.organizations as Array<{ name?: string }> | undefined;

  const name =
    names?.[0]?.displayName ||
    names?.[0]?.unstructuredName ||
    "";
  const phoneList = (phones || [])
    .map((x) => x.canonicalForm || x.value || "")
    .filter(Boolean);

  if (!name && phoneList.length === 0) return null;
  if (phoneList.length === 0) return null; // require phone for sending contact

  return {
    name: name || phoneList[0],
    phones: phoneList,
    emails: (emails || []).map((x) => x.value || "").filter(Boolean),
    organization: orgs?.[0]?.name,
  };
}

function buildVCard(c: PickedContact): string {
  const lines = ["BEGIN:VCARD", "VERSION:3.0"];
  lines.push(`FN:${escapeVCard(c.name)}`);
  lines.push(`N:${escapeVCard(c.name)};;;;`);
  for (const phone of c.phones) {
    lines.push(`TEL;TYPE=CELL:${phone}`);
  }
  for (const email of c.emails) {
    lines.push(`EMAIL:${escapeVCard(email)}`);
  }
  if (c.organization) {
    lines.push(`ORG:${escapeVCard(c.organization)}`);
  }
  lines.push("END:VCARD");
  return lines.join("\r\n");
}

function escapeVCard(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}
