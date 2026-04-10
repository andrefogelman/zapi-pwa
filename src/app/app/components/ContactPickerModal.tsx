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
      const res = await fetch(
        "https://people.googleapis.com/v1/people/me/connections?personFields=names,phoneNumbers,emailAddresses,organizations&pageSize=1000",
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.status === 401) {
        setError("Token do Google expirou. Reconecte para acessar contatos.");
        setGoogleContacts(null);
        return;
      }
      if (!res.ok) {
        setError(`Falha ao carregar contatos (HTTP ${res.status})`);
        return;
      }
      const data = await res.json();
      const connections: Array<Record<string, unknown>> = data.connections || [];
      const parsed: PickedContact[] = connections
        .map((p) => {
          const names = p.names as Array<{ displayName?: string }> | undefined;
          const phones = p.phoneNumbers as Array<{ value?: string }> | undefined;
          const emails = p.emailAddresses as Array<{ value?: string }> | undefined;
          const orgs = p.organizations as Array<{ name?: string }> | undefined;
          return {
            name: names?.[0]?.displayName || "",
            phones: (phones || []).map((x) => x.value || "").filter(Boolean),
            emails: (emails || []).map((x) => x.value || "").filter(Boolean),
            organization: orgs?.[0]?.name,
          };
        })
        .filter((c) => c.name && c.phones.length > 0)
        .sort((a, b) => a.name.localeCompare(b.name));
      setGoogleContacts(parsed);
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
    const q = search.trim().toLowerCase();
    if (!q) return googleContacts;
    return googleContacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phones.some((p) => p.includes(q)) ||
        c.emails.some((e) => e.toLowerCase().includes(q))
    );
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
                <div className="wa-modal-error">{error}</div>
              ) : googleContacts && googleContacts.length === 0 ? (
                <div className="wa-contact-empty">Nenhum contato encontrado na conta Google.</div>
              ) : (
                <>
                  <input
                    className="wa-modal-search"
                    placeholder="Buscar contato..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
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
