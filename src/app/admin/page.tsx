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
}

interface FetchedGroup {
  group_id: string;
  subject: string;
  subject_owner: string;
  group_lid: string;
}

type Tab = "zapi" | "neura" | "grupos";

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
  const [newGroup, setNewGroup] = useState<GroupRow>({ group_id: "", subject: "", subject_owner: "", group_lid: "" });
  const [groupMsg, setGroupMsg] = useState("");

  // Fetch from WhatsApp state
  const [fetchedGroups, setFetchedGroups] = useState<FetchedGroup[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState("");

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
    setNewGroup({ group_id: "", subject: "", subject_owner: "", group_lid: "" });
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
        setFetchedGroups(data.groups);
        setFetchMsg(`${data.groups.length} grupos encontrados no WhatsApp`);
      }
    } catch {
      setFetchMsg("Erro ao buscar grupos");
    }
    setFetching(false);
  }

  async function importGroup(g: FetchedGroup) {
    const { error } = await supabase.from("grupos_autorizados").upsert({
      group_id: g.group_id,
      subject: g.subject,
      subject_owner: g.subject_owner,
      group_lid: g.group_lid,
    }, { onConflict: "group_id" });
    if (error) {
      setFetchMsg(`Erro ao importar: ${error.message}`);
      return;
    }
    loadGroups();
    setFetchedGroups((prev) => prev.filter((x) => x.group_id !== g.group_id));
  }

  async function importAllGroups() {
    let imported = 0;
    for (const g of fetchedGroups) {
      const { error } = await supabase.from("grupos_autorizados").upsert({
        group_id: g.group_id,
        subject: g.subject,
        subject_owner: g.subject_owner,
        group_lid: g.group_lid,
      }, { onConflict: "group_id" });
      if (!error) imported++;
    }
    setFetchMsg(`${imported} grupos importados/atualizados`);
    setFetchedGroups([]);
    loadGroups();
  }

  async function removeGroup(groupId: string) {
    await supabase.from("grupos_autorizados").delete().eq("group_id", groupId);
    loadGroups();
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
            <button onClick={fetchFromWhatsApp} disabled={fetching} style={{ padding: "0.5rem 1rem", marginRight: "0.5rem" }}>
              {fetching ? "Buscando..." : "Buscar Grupos"}
            </button>
            {fetchedGroups.length > 0 && (
              <button onClick={importAllGroups} style={{ padding: "0.5rem 1rem", background: "#4CAF50", color: "#fff", border: "none", borderRadius: "4px" }}>
                Importar Todos ({fetchedGroups.length})
              </button>
            )}
            {fetchMsg && <p style={{ margin: "0.5rem 0 0" }}>{fetchMsg}</p>}

            {fetchedGroups.length > 0 && (
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
                  {fetchedGroups.map((g) => (
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
            )}
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
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #333" }}>
                <th style={{ textAlign: "left", padding: "0.5rem" }}>Subject</th>
                <th style={{ textAlign: "left", padding: "0.5rem" }}>Group ID</th>
                <th style={{ textAlign: "left", padding: "0.5rem" }}>Owner</th>
                <th style={{ textAlign: "left", padding: "0.5rem" }}>LID</th>
                <th style={{ padding: "0.5rem" }}></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.group_id} style={{ borderBottom: "1px solid #ddd" }}>
                  <td style={{ padding: "0.5rem" }}>{g.subject}</td>
                  <td style={{ padding: "0.5rem", fontSize: "0.75rem", wordBreak: "break-all" }}>{g.group_id}</td>
                  <td style={{ padding: "0.5rem", fontSize: "0.75rem" }}>{g.subject_owner}</td>
                  <td style={{ padding: "0.5rem", fontSize: "0.75rem" }}>{g.group_lid || "—"}</td>
                  <td style={{ padding: "0.5rem" }}>
                    <button onClick={() => removeGroup(g.group_id)} style={{ color: "red", cursor: "pointer", background: "none", border: "none" }}>Remover</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
