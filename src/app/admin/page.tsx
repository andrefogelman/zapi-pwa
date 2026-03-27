"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

interface ZapiConfigRow {
  id: string;
  instance_id: string;
  token: string;
  webhook_token: string;
  connected_phone: string;
  my_phones: string[];
  my_lids: string[];
}

interface GroupRow {
  group_id: string;
  subject: string;
  subject_owner: string;
}

export default function AdminPage() {
  const supabase = getSupabaseBrowser();
  const router = useRouter();

  // Config state
  const [config, setConfig] = useState<ZapiConfigRow | null>(null);
  const [configSaving, setConfigSaving] = useState(false);
  const [configMsg, setConfigMsg] = useState("");

  // Groups state
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [newGroup, setNewGroup] = useState<GroupRow>({ group_id: "", subject: "", subject_owner: "" });
  const [groupMsg, setGroupMsg] = useState("");

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

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!config) return;
    setConfigSaving(true);
    setConfigMsg("");

    const { error } = await supabase
      .from("zapi_config")
      .update({
        instance_id: config.instance_id,
        token: config.token,
        webhook_token: config.webhook_token,
        connected_phone: config.connected_phone,
        my_phones: config.my_phones,
        my_lids: config.my_lids,
        updated_at: new Date().toISOString(),
      })
      .eq("id", config.id);

    setConfigSaving(false);
    setConfigMsg(error ? `Erro: ${error.message}` : "Salvo!");
  }

  async function addGroup(e: React.FormEvent) {
    e.preventDefault();
    setGroupMsg("");
    const { error } = await supabase.from("grupos_autorizados").insert(newGroup);
    if (error) {
      setGroupMsg(`Erro: ${error.message}`);
      return;
    }
    setNewGroup({ group_id: "", subject: "", subject_owner: "" });
    setGroupMsg("Grupo adicionado!");
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

  return (
    <main style={{ maxWidth: 700, margin: "2rem auto", fontFamily: "sans-serif", padding: "0 1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Admin - zapi-transcriber</h1>
        <button onClick={handleLogout} style={{ padding: "0.5rem 1rem" }}>Sair</button>
      </div>

      <hr />

      {/* Z-API Config Section */}
      <h2>Configuração Z-API</h2>
      {config && (
        <form onSubmit={saveConfig}>
          <label>Instance ID</label>
          <input style={inputStyle} value={config.instance_id} onChange={(e) => setConfig({ ...config, instance_id: e.target.value })} />

          <label>Token</label>
          <input style={inputStyle} value={config.token} onChange={(e) => setConfig({ ...config, token: e.target.value })} />

          <label>Webhook Token</label>
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
          {configMsg && <p>{configMsg}</p>}
        </form>
      )}

      <hr style={{ margin: "2rem 0" }} />

      {/* Groups Section */}
      <h2>Grupos Autorizados ({groups.length})</h2>

      <form onSubmit={addGroup} style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <input placeholder="group_id (ex: 120363...@g.us)" value={newGroup.group_id} onChange={(e) => setNewGroup({ ...newGroup, group_id: e.target.value })} required style={{ flex: 1, padding: "0.5rem", minWidth: "200px" }} />
          <input placeholder="subject" value={newGroup.subject} onChange={(e) => setNewGroup({ ...newGroup, subject: e.target.value })} required style={{ flex: 1, padding: "0.5rem", minWidth: "150px" }} />
          <input placeholder="subject_owner" value={newGroup.subject_owner} onChange={(e) => setNewGroup({ ...newGroup, subject_owner: e.target.value })} required style={{ flex: 1, padding: "0.5rem", minWidth: "150px" }} />
          <button type="submit" style={{ padding: "0.5rem 1rem" }}>Adicionar</button>
        </div>
        {groupMsg && <p>{groupMsg}</p>}
      </form>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #333" }}>
            <th style={{ textAlign: "left", padding: "0.5rem" }}>Group ID</th>
            <th style={{ textAlign: "left", padding: "0.5rem" }}>Subject</th>
            <th style={{ textAlign: "left", padding: "0.5rem" }}>Owner</th>
            <th style={{ padding: "0.5rem" }}></th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.group_id} style={{ borderBottom: "1px solid #ddd" }}>
              <td style={{ padding: "0.5rem", fontSize: "0.8rem", wordBreak: "break-all" }}>{g.group_id}</td>
              <td style={{ padding: "0.5rem" }}>{g.subject}</td>
              <td style={{ padding: "0.5rem", fontSize: "0.8rem" }}>{g.subject_owner}</td>
              <td style={{ padding: "0.5rem" }}>
                <button onClick={() => removeGroup(g.group_id)} style={{ color: "red", cursor: "pointer", background: "none", border: "none" }}>Remover</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
