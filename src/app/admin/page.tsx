"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

interface ZapiConfigRow {
  id: string;
  instance_id: string;
  token: string;
  client_token: string;
  webhook_token: string;
  connected_phone: string;
  my_phones: string[];
  my_lids: string[];
  neura_prompt: string;
  neura_model: string;
  neura_temperature: number;
  neura_top_p: number;
}

interface GroupRow {
  group_id: string;
  subject: string;
  subject_owner: string;
  group_lid?: string;
  monitor_daily: boolean;
  transcribe_all: boolean;
}

interface FetchedGroup {
  group_id: string;
  subject: string;
  subject_owner: string;
  group_lid: string;
  _phone?: string;
}

type Tab = "zapi" | "neura" | "grupos" | "resumos";

export default function AdminPage() {
  const supabase = getSupabaseBrowser();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("zapi");

  // Config state
  const [config, setConfig] = useState<ZapiConfigRow | null>(null);
  const [configSaving, setConfigSaving] = useState(false);
  const [configMsg, setConfigMsg] = useState("");

  // Groups state
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [newGroup, setNewGroup] = useState<GroupRow>({ group_id: "", subject: "", subject_owner: "", group_lid: "", monitor_daily: false, transcribe_all: false });
  const [groupMsg, setGroupMsg] = useState("");

  // Fetch from WhatsApp state
  const [fetchedGroups, setFetchedGroups] = useState<FetchedGroup[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState("");
  const [searchFetch, setSearchFetch] = useState("");
  const [searchGroups, setSearchGroups] = useState("");

  // Summary state
  const [summaryChats, setSummaryChats] = useState<Array<{jid: string; name: string}>>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [summaryPeriod, setSummaryPeriod] = useState("última semana");
  const [customAfter, setCustomAfter] = useState("");
  const [customBefore, setCustomBefore] = useState("");
  const [summaryResult, setSummaryResult] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryMsg, setSummaryMsg] = useState("");
  const [summaryPartial, setSummaryPartial] = useState(false);
  const [chatSearchSummary, setChatSearchSummary] = useState("");

  useEffect(() => {
    loadConfig();
    loadGroups();
  }, []);

  async function loadConfig() {
    const { data } = await supabase.from("zapi_config").select("*").limit(1).single();
    if (data) setConfig(data);
  }

  async function loadGroups() {
    const { data } = await supabase.from("grupos_autorizados").select("*").order("subject");
    if (data) setGroups(data);
  }

  async function saveConfig(fields: Partial<ZapiConfigRow>) {
    if (!config) return;
    setConfigSaving(true);
    setConfigMsg("");

    const { error } = await supabase
      .from("zapi_config")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", config.id);

    setConfigSaving(false);
    setConfigMsg(error ? `Erro: ${error.message}` : "Salvo!");
    setTimeout(() => setConfigMsg(""), 3000);
  }

  async function saveZapiConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!config) return;
    await saveConfig({
      instance_id: config.instance_id,
      token: config.token,
      client_token: config.client_token,
      webhook_token: config.webhook_token,
      connected_phone: config.connected_phone,
      my_phones: config.my_phones,
      my_lids: config.my_lids,
    });
  }

  async function saveNeuraConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!config) return;
    await saveConfig({
      neura_prompt: config.neura_prompt,
      neura_model: config.neura_model,
      neura_temperature: config.neura_temperature,
      neura_top_p: config.neura_top_p,
    });
  }

  async function addGroup(e: React.FormEvent) {
    e.preventDefault();
    setGroupMsg("");
    const { error } = await supabase.from("grupos_autorizados").upsert(newGroup, { onConflict: "group_id" });
    if (error) {
      setGroupMsg(`Erro: ${error.message}`);
      return;
    }
    setNewGroup({ group_id: "", subject: "", subject_owner: "", group_lid: "", monitor_daily: false, transcribe_all: false });
    setGroupMsg("Grupo adicionado!");
    loadGroups();
  }

  async function fetchFromWhatsApp() {
    setFetching(true);
    setFetchMsg("");
    try {
      const res = await fetch("/api/groups/fetch");
      const data = await res.json();
      if (data.error) {
        setFetchMsg(`Erro: ${data.error}`);
      } else {
        // Filter out groups already imported
        const importedIds = new Set(groups.map((g) => g.group_id));
        const notImported = (data.groups as FetchedGroup[]).filter((g) => !importedIds.has(g.group_id));
        setFetchedGroups(notImported);
        setFetchMsg(`${notImported.length} grupos novos (${data.groups.length} total no WhatsApp)`);
      }
    } catch {
      setFetchMsg("Erro ao buscar grupos");
    }
    setFetching(false);
  }

  async function enrichAndImport(g: FetchedGroup & { _phone?: string }): Promise<boolean> {
    // Fetch metadata to get subject_owner and LID
    let enriched = { ...g };
    if (g._phone) {
      try {
        const metaRes = await fetch(`/api/groups/metadata?phone=${encodeURIComponent(g._phone)}`);
        if (metaRes.ok) {
          const meta = await metaRes.json();
          enriched = { ...enriched, ...meta };
        }
      } catch { /* use basic data */ }
    }

    const { error } = await supabase.from("grupos_autorizados").upsert({
      group_id: enriched.group_id,
      subject: enriched.subject,
      subject_owner: enriched.subject_owner || "",
      group_lid: enriched.group_lid || "",
    }, { onConflict: "group_id" });

    if (error) {
      setFetchMsg(`Erro ao importar ${enriched.subject}: ${error.message}`);
      return false;
    }
    return true;
  }

  async function importGroup(g: FetchedGroup & { _phone?: string }) {
    setFetchMsg(`Importando ${g.subject}...`);
    const ok = await enrichAndImport(g);
    if (ok) {
      setFetchMsg(`${g.subject} importado!`);
      loadGroups();
      setFetchedGroups((prev) => prev.filter((x) => x.group_id !== g.group_id));
    }
  }

  async function importAllGroups() {
    let imported = 0;
    const total = fetchedGroups.length;
    for (let i = 0; i < total; i++) {
      setFetchMsg(`Importando ${i + 1}/${total}: ${fetchedGroups[i].subject}...`);
      const ok = await enrichAndImport(fetchedGroups[i]);
      if (ok) imported++;
    }
    setFetchMsg(`${imported}/${total} grupos importados/atualizados`);
    setFetchedGroups([]);
    loadGroups();
  }

  async function removeGroup(groupId: string) {
    await supabase.from("grupos_autorizados").delete().eq("group_id", groupId);
    loadGroups();
  }

  async function toggleGroupFlag(groupId: string, field: "monitor_daily" | "transcribe_all", value: boolean) {
    await supabase.from("grupos_autorizados").update({ [field]: value }).eq("group_id", groupId);
    setGroups((prev) => prev.map((g) => g.group_id === groupId ? { ...g, [field]: value } : g));
  }

  async function loadSummaryChats(query?: string) {
    const res = await fetch(`/api/chats-proxy?limit=200${query ? `&query=${encodeURIComponent(query)}` : ""}`);
    const data = await res.json();
    if (data.chats) setSummaryChats(data.chats.filter((c: { isGroup: boolean }) => c.isGroup));
  }

  async function generateSummary(sendWhatsApp = false) {
    if (selectedGroups.length === 0) { setSummaryMsg("Selecione pelo menos um grupo"); return; }
    setSummaryLoading(true);
    setSummaryMsg("");
    setSummaryResult("");
    try {
      const payload: Record<string, unknown> = { groupIds: selectedGroups, sendWhatsApp };
      if (summaryPeriod === "custom") {
        payload.after = customAfter;
        payload.before = customBefore;
      } else {
        payload.period = summaryPeriod;
      }
      const res = await fetch("/api/summary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (data.error) { setSummaryMsg(`Erro: ${data.message || data.error}`); }
      else {
        setSummaryResult(data.summary);
        setSummaryPartial(data.partial);
        if (sendWhatsApp) setSummaryMsg("Resumo enviado no WhatsApp!");
      }
    } catch { setSummaryMsg("Erro ao gerar resumo"); }
    setSummaryLoading(false);
  }

  function exportPDF() {
    const content = document.getElementById("summary-content");
    if (!content) return;
    const win = window.open("", "_blank");
    if (!win) return;
    const groups = selectedGroups.length > 0 ? `Grupos: ${selectedGroups.length}` : "";
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Resumo - ${summaryPeriod}</title>
      <style>body{font-family:sans-serif;padding:2rem;line-height:1.6;max-width:800px;margin:0 auto}
      h1{font-size:1.3rem;border-bottom:1px solid #ccc;padding-bottom:0.5rem}
      h2{font-size:1.1rem;margin-top:1.5rem}h3{font-size:1rem}
      p,li{font-size:0.9rem}hr{margin:1.5rem 0;border:none;border-top:1px solid #ddd}
      .meta{color:#666;font-size:0.8rem;margin-bottom:1rem}</style></head><body>
      <h1>Resumo de Grupos WhatsApp</h1>
      <p class="meta">Período: ${summaryPeriod} | ${groups} | Gerado em: ${new Date().toLocaleString("pt-BR")}</p>
      <div>${content.innerText.replace(/\n/g, "<br>")}</div></body></html>`);
    win.document.close();
    win.print();
  }

  function toggleSummaryGroup(jid: string) {
    setSelectedGroups(prev => prev.includes(jid) ? prev.filter(g => g !== jid) : [...prev, jid]);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/admin/login");
  }

  const inputStyle = { display: "block" as const, width: "100%", padding: "0.5rem", marginTop: "0.25rem", marginBottom: "0.75rem" };
  const tabStyle = (t: Tab) => ({
    padding: "0.5rem 1.5rem",
    cursor: "pointer" as const,
    border: "none",
    borderBottom: tab === t ? "3px solid #333" : "3px solid transparent",
    background: "none",
    fontWeight: tab === t ? "bold" as const : "normal" as const,
    fontSize: "1rem",
  });

  return (
    <main style={{ maxWidth: 700, margin: "2rem auto", fontFamily: "sans-serif", padding: "0 1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Admin - zapi-transcriber</h1>
        <button onClick={handleLogout} style={{ padding: "0.5rem 1rem" }}>Sair</button>
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: "1px solid #ddd", marginBottom: "1.5rem" }}>
        <button style={tabStyle("zapi")} onClick={() => setTab("zapi")}>Z-API</button>
        <button style={tabStyle("neura")} onClick={() => setTab("neura")}>Neura (IA)</button>
        <button style={tabStyle("grupos")} onClick={() => setTab("grupos")}>Grupos ({groups.length})</button>
        <button style={tabStyle("resumos")} onClick={() => { setTab("resumos"); if (summaryChats.length === 0) loadSummaryChats(); }}>Resumos</button>
      </div>

      {/* Z-API Config Tab */}
      {tab === "zapi" && config && (
        <form onSubmit={saveZapiConfig}>
          <label>Instance ID</label>
          <input style={inputStyle} value={config.instance_id} onChange={(e) => setConfig({ ...config, instance_id: e.target.value })} />

          <label>Token da Instância</label>
          <input style={inputStyle} value={config.token} onChange={(e) => setConfig({ ...config, token: e.target.value })} />

          <label>Client Token (Token de segurança da conta)</label>
          <input style={inputStyle} value={config.client_token} onChange={(e) => setConfig({ ...config, client_token: e.target.value })} />

          <label>Webhook Token (opcional)</label>
          <input style={inputStyle} value={config.webhook_token} onChange={(e) => setConfig({ ...config, webhook_token: e.target.value })} />

          <label>Connected Phone</label>
          <input style={inputStyle} value={config.connected_phone} onChange={(e) => setConfig({ ...config, connected_phone: e.target.value })} />

          <label>My Phones (separados por vírgula)</label>
          <input style={inputStyle} value={config.my_phones.join(",")} onChange={(e) => setConfig({ ...config, my_phones: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })} />

          <label>My LIDs (separados por vírgula)</label>
          <input style={inputStyle} value={config.my_lids.join(",")} onChange={(e) => setConfig({ ...config, my_lids: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })} />

          <button type="submit" disabled={configSaving} style={{ padding: "0.5rem 1rem" }}>
            {configSaving ? "Salvando..." : "Salvar Config"}
          </button>
          {configMsg && <p style={{ color: configMsg.startsWith("Erro") ? "red" : "green" }}>{configMsg}</p>}
        </form>
      )}

      {/* Neura Tab */}
      {tab === "neura" && config && (
        <form onSubmit={saveNeuraConfig}>
          <label>System Prompt</label>
          <textarea
            style={{ ...inputStyle, minHeight: "300px", fontFamily: "monospace", fontSize: "0.85rem", resize: "vertical" as const }}
            value={config.neura_prompt}
            onChange={(e) => setConfig({ ...config, neura_prompt: e.target.value })}
          />

          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: "150px" }}>
              <label>Modelo</label>
              <select
                style={inputStyle}
                value={config.neura_model}
                onChange={(e) => setConfig({ ...config, neura_model: e.target.value })}
              >
                <option value="gpt-4o">gpt-4o</option>
                <option value="gpt-4o-mini">gpt-4o-mini</option>
                <option value="gpt-4.1">gpt-4.1</option>
                <option value="gpt-4.1-mini">gpt-4.1-mini</option>
                <option value="gpt-4.1-nano">gpt-4.1-nano</option>
              </select>
            </div>
            <div style={{ flex: 1, minWidth: "150px" }}>
              <label>Temperature ({config.neura_temperature})</label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                style={{ ...inputStyle, padding: 0 }}
                value={config.neura_temperature}
                onChange={(e) => setConfig({ ...config, neura_temperature: parseFloat(e.target.value) })}
              />
            </div>
            <div style={{ flex: 1, minWidth: "150px" }}>
              <label>Top P ({config.neura_top_p})</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                style={{ ...inputStyle, padding: 0 }}
                value={config.neura_top_p}
                onChange={(e) => setConfig({ ...config, neura_top_p: parseFloat(e.target.value) })}
              />
            </div>
          </div>

          <button type="submit" disabled={configSaving} style={{ padding: "0.5rem 1rem" }}>
            {configSaving ? "Salvando..." : "Salvar Neura"}
          </button>
          {configMsg && <p style={{ color: configMsg.startsWith("Erro") ? "red" : "green" }}>{configMsg}</p>}
        </form>
      )}

      {/* Groups Tab */}
      {tab === "grupos" && (
        <>
          {/* Fetch from WhatsApp */}
          <div style={{ marginBottom: "1.5rem", padding: "1rem", border: "1px solid #ddd", borderRadius: "4px" }}>
            <h3 style={{ margin: "0 0 0.5rem" }}>Buscar do WhatsApp</h3>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
              <button onClick={fetchFromWhatsApp} disabled={fetching} style={{ padding: "0.5rem 1rem" }}>
                {fetching ? "Buscando..." : "Buscar Grupos"}
              </button>
              {fetchedGroups.length > 0 && (
                <>
                  <input
                    placeholder="Filtrar por nome..."
                    value={searchFetch}
                    onChange={(e) => setSearchFetch(e.target.value)}
                    style={{ padding: "0.5rem", flex: 1, minWidth: "150px" }}
                  />
                  <button onClick={importAllGroups} style={{ padding: "0.5rem 1rem", background: "#4CAF50", color: "#fff", border: "none", borderRadius: "4px" }}>
                    Importar Todos ({fetchedGroups.length})
                  </button>
                </>
              )}
            </div>
            {fetchMsg && <p style={{ margin: "0.5rem 0 0" }}>{fetchMsg}</p>}

            {fetchedGroups.length > 0 && (() => {
              const filtered = fetchedGroups.filter((g) =>
                !searchFetch || g.subject.toLowerCase().includes(searchFetch.toLowerCase())
              );
              return (
                <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "0.5rem", fontSize: "0.85rem" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #ccc" }}>
                      <th style={{ textAlign: "left", padding: "0.3rem" }}>Nome</th>
                      <th style={{ textAlign: "left", padding: "0.3rem" }}>Group ID</th>
                      <th style={{ textAlign: "left", padding: "0.3rem" }}>LID</th>
                      <th style={{ padding: "0.3rem" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((g) => (
                      <tr key={g.group_id} style={{ borderBottom: "1px solid #eee" }}>
                        <td style={{ padding: "0.3rem" }}>{g.subject}</td>
                        <td style={{ padding: "0.3rem", fontSize: "0.75rem", wordBreak: "break-all" }}>{g.group_id}</td>
                        <td style={{ padding: "0.3rem", fontSize: "0.75rem" }}>{g.group_lid || "—"}</td>
                        <td style={{ padding: "0.3rem" }}>
                          <button onClick={() => importGroup(g)} style={{ padding: "0.2rem 0.5rem", fontSize: "0.8rem" }}>Importar</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
          </div>

          {/* Manual add */}
          <h3>Adicionar manualmente</h3>
          <form onSubmit={addGroup} style={{ marginBottom: "1rem" }}>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <input placeholder="group_id (ex: 120363...@g.us)" value={newGroup.group_id} onChange={(e) => setNewGroup({ ...newGroup, group_id: e.target.value })} required style={{ flex: 1, padding: "0.5rem", minWidth: "200px" }} />
              <input placeholder="subject" value={newGroup.subject} onChange={(e) => setNewGroup({ ...newGroup, subject: e.target.value })} required style={{ flex: 1, padding: "0.5rem", minWidth: "120px" }} />
              <input placeholder="subject_owner" value={newGroup.subject_owner} onChange={(e) => setNewGroup({ ...newGroup, subject_owner: e.target.value })} required style={{ flex: 1, padding: "0.5rem", minWidth: "120px" }} />
              <input placeholder="LID (opcional)" value={newGroup.group_lid || ""} onChange={(e) => setNewGroup({ ...newGroup, group_lid: e.target.value })} style={{ flex: 1, padding: "0.5rem", minWidth: "100px" }} />
              <button type="submit" style={{ padding: "0.5rem 1rem" }}>Adicionar</button>
            </div>
            {groupMsg && <p>{groupMsg}</p>}
          </form>

          {/* Groups table */}
          <h3>Grupos Autorizados ({groups.length})</h3>
          <input
            placeholder="Buscar grupo por nome..."
            value={searchGroups}
            onChange={(e) => setSearchGroups(e.target.value)}
            style={{ display: "block", width: "100%", padding: "0.5rem", marginBottom: "0.5rem" }}
          />
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #333" }}>
                <th style={{ textAlign: "left", padding: "0.5rem" }}>Subject</th>
                <th style={{ textAlign: "left", padding: "0.5rem" }}>Group ID</th>
                <th style={{ textAlign: "center", padding: "0.5rem", fontSize: "0.8rem" }} title="Transcrever todos os áudios do grupo (não só os seus)">Transcrever todos</th>
                <th style={{ textAlign: "center", padding: "0.5rem", fontSize: "0.8rem" }} title="Monitorar mensagens e gerar relatório diário">Report diário</th>
                <th style={{ padding: "0.5rem" }}></th>
              </tr>
            </thead>
            <tbody>
              {groups
                .filter((g) => !searchGroups || g.subject.toLowerCase().includes(searchGroups.toLowerCase()) || g.group_id.includes(searchGroups))
                .map((g) => (
                <tr key={g.group_id} style={{ borderBottom: "1px solid #ddd" }}>
                  <td style={{ padding: "0.5rem" }}>{g.subject}</td>
                  <td style={{ padding: "0.5rem", fontSize: "0.7rem", wordBreak: "break-all", maxWidth: "200px" }}>{g.group_id}</td>
                  <td style={{ textAlign: "center", padding: "0.5rem" }}>
                    <input
                      type="checkbox"
                      checked={g.transcribe_all}
                      onChange={(e) => toggleGroupFlag(g.group_id, "transcribe_all", e.target.checked)}
                      style={{ width: "1.2rem", height: "1.2rem", cursor: "pointer" }}
                    />
                  </td>
                  <td style={{ textAlign: "center", padding: "0.5rem" }}>
                    <input
                      type="checkbox"
                      checked={g.monitor_daily}
                      onChange={(e) => toggleGroupFlag(g.group_id, "monitor_daily", e.target.checked)}
                      style={{ width: "1.2rem", height: "1.2rem", cursor: "pointer" }}
                    />
                  </td>
                  <td style={{ padding: "0.5rem" }}>
                    <button onClick={() => removeGroup(g.group_id)} style={{ color: "red", cursor: "pointer", background: "none", border: "none" }}>Remover</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Resumos Tab */}
      {tab === "resumos" && (
        <>
          <h3>Selecionar Grupos</h3>
          <input placeholder="Buscar grupo..." value={chatSearchSummary} onChange={(e) => { setChatSearchSummary(e.target.value); loadSummaryChats(e.target.value); }} style={{ display: "block", width: "100%", padding: "0.5rem", marginBottom: "0.5rem" }} />
          <div style={{ maxHeight: "200px", overflowY: "auto", border: "1px solid #ddd", borderRadius: "4px", marginBottom: "1rem" }}>
            {summaryChats.map((g) => (
              <label key={g.jid} style={{ display: "flex", alignItems: "center", padding: "0.3rem 0.5rem", cursor: "pointer", borderBottom: "1px solid #eee", background: selectedGroups.includes(g.jid) ? "#e8f5e9" : "transparent" }}>
                <input type="checkbox" checked={selectedGroups.includes(g.jid)} onChange={() => toggleSummaryGroup(g.jid)} style={{ marginRight: "0.5rem" }} />
                {g.name}
              </label>
            ))}
            {summaryChats.length === 0 && <p style={{ padding: "0.5rem", color: "#999" }}>Carregando grupos...</p>}
          </div>
          {selectedGroups.length > 0 && <p style={{ fontSize: "0.85rem", color: "#666" }}>{selectedGroups.length} grupo(s) selecionado(s)</p>}

          <h3>Período</h3>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
            {["hoje", "ontem", "últimos 3 dias", "última semana", "último mês", "custom"].map((p) => (
              <button key={p} onClick={() => setSummaryPeriod(p)} style={{ padding: "0.3rem 0.8rem", background: summaryPeriod === p ? "#333" : "#eee", color: summaryPeriod === p ? "#fff" : "#333", border: "none", borderRadius: "4px", cursor: "pointer" }}>
                {p === "custom" ? "Personalizado" : p}
              </button>
            ))}
          </div>
          {summaryPeriod === "custom" && (
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
              <input type="date" value={customAfter} onChange={(e) => setCustomAfter(e.target.value)} style={{ padding: "0.5rem" }} />
              <span style={{ alignSelf: "center" }}>até</span>
              <input type="date" value={customBefore} onChange={(e) => setCustomBefore(e.target.value)} style={{ padding: "0.5rem" }} />
            </div>
          )}

          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
            <button onClick={() => generateSummary(false)} disabled={summaryLoading} style={{ padding: "0.5rem 1rem" }}>
              {summaryLoading ? "Gerando..." : "Gerar Resumo"}
            </button>
            <button onClick={() => generateSummary(true)} disabled={summaryLoading} style={{ padding: "0.5rem 1rem", background: "#4CAF50", color: "#fff", border: "none", borderRadius: "4px" }}>
              {summaryLoading ? "Enviando..." : "Gerar e Enviar WhatsApp"}
            </button>
          </div>
          {summaryMsg && <p>{summaryMsg}</p>}

          {summaryResult && (
            <>
              <div style={{ marginBottom: "0.5rem" }}>
                <button onClick={() => exportPDF()} style={{ padding: "0.5rem 1rem", background: "#1976D2", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer" }}>
                  Salvar PDF
                </button>
              </div>
              <div id="summary-content" style={{ border: "1px solid #ddd", borderRadius: "4px", padding: "1rem", whiteSpace: "pre-wrap", fontFamily: "sans-serif", fontSize: "0.9rem", lineHeight: "1.5" }}>
                {summaryPartial && <p style={{ color: "orange", fontWeight: "bold" }}>⚠️ Resumo parcial — período muito grande</p>}
                {summaryResult}
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}
