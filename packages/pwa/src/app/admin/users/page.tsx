"use client";
import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

interface AdminUser {
  id: string;
  email: string;
  display_name: string | null;
  role: "user" | "super_admin" | null;
  status: "active" | "disabled" | null;
  instance_count: number;
  last_sign_in_at: string | null;
  is_pending_invite: boolean;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [invitingEmail, setInvitingEmail] = useState("");
  const [msg, setMsg] = useState<string>("");
  const [me, setMe] = useState<string | null>(null);

  async function getSession() {
    const supabase = getSupabaseBrowser();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("no session");
    return session;
  }

  async function token() {
    const session = await getSession();
    setMe(session.user.id);
    return session.access_token;
  }

  async function load() {
    setLoading(true);
    try {
      const t = await token();
      const res = await fetch("/api/admin/users", {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setUsers(data.users ?? []);
    } catch (err) {
      setMsg(`Erro: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function invite() {
    if (!invitingEmail.includes("@")) return;
    const t = await token();
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${t}`,
      },
      body: JSON.stringify({ email: invitingEmail }),
    });
    if (res.ok) {
      setMsg("Convite enviado!");
      setInvitingEmail("");
      load();
    } else {
      setMsg(`Erro: ${await res.text()}`);
    }
    setTimeout(() => setMsg(""), 3000);
  }

  async function doAction(
    userId: string,
    path: string,
    method: string,
    body?: unknown,
  ) {
    const t = await token();
    const res = await fetch(`/api/admin/users/${userId}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${t}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      setMsg(`Erro: ${await res.text()}`);
      setTimeout(() => setMsg(""), 3000);
      return;
    }
    load();
  }

  if (loading) return <div>Carregando...</div>;

  return (
    <div>
      <h1>Usuários</h1>

      <div
        style={{
          background: "#fff",
          padding: "1rem",
          borderRadius: 8,
          marginBottom: "1.5rem",
          border: "1px solid #ddd",
        }}
      >
        <h3 style={{ marginTop: 0 }}>Convidar novo usuário</h3>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            type="email"
            placeholder="email@exemplo.com"
            value={invitingEmail}
            onChange={(e) => setInvitingEmail(e.target.value)}
            style={{ flex: 1, padding: "0.5rem" }}
          />
          <button onClick={invite} style={{ padding: "0.5rem 1rem" }}>
            Convidar
          </button>
        </div>
        {msg && (
          <p
            style={{
              marginTop: "0.5rem",
              color: msg.startsWith("Erro") ? "red" : "green",
            }}
          >
            {msg}
          </p>
        )}
      </div>

      <table style={{ width: "100%", background: "#fff", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#eee", textAlign: "left" }}>
            <th style={{ padding: "0.75rem" }}>Email</th>
            <th style={{ padding: "0.75rem" }}>Nome</th>
            <th style={{ padding: "0.75rem" }}>Role</th>
            <th style={{ padding: "0.75rem" }}>Status</th>
            <th style={{ padding: "0.75rem" }}>Linhas</th>
            <th style={{ padding: "0.75rem" }}>Ações</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const isSelf = u.id === me;
            return (
              <tr key={u.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "0.75rem" }}>
                  {u.email}
                  {u.is_pending_invite ? " (pendente)" : ""}
                </td>
                <td style={{ padding: "0.75rem" }}>{u.display_name ?? "—"}</td>
                <td style={{ padding: "0.75rem" }}>{u.role ?? "—"}</td>
                <td style={{ padding: "0.75rem" }}>{u.status ?? "—"}</td>
                <td style={{ padding: "0.75rem" }}>{u.instance_count}</td>
                <td style={{ padding: "0.75rem", fontSize: "0.85rem" }}>
                  {u.is_pending_invite && (
                    <button onClick={() => doAction(u.id, "/resend", "POST")}>
                      Reenviar
                    </button>
                  )}{" "}
                  <button onClick={() => doAction(u.id, "/reset", "POST")}>
                    Reset senha
                  </button>{" "}
                  {!isSelf && (
                    <>
                      <button
                        onClick={() =>
                          doAction(u.id, "/role", "PATCH", {
                            role: u.role === "super_admin" ? "user" : "super_admin",
                          })
                        }
                      >
                        {u.role === "super_admin" ? "Rebaixar" : "Promover"}
                      </button>{" "}
                      <button
                        onClick={() =>
                          doAction(u.id, "/disable", "PATCH", {
                            disabled: u.status !== "disabled",
                          })
                        }
                      >
                        {u.status === "disabled" ? "Reativar" : "Desabilitar"}
                      </button>{" "}
                      <button
                        onClick={() => {
                          if (
                            !confirm(
                              `Deletar ${u.email}? Apaga TODAS as instâncias e mensagens em cascata.`,
                            )
                          ) {
                            return;
                          }
                          doAction(u.id, "", "DELETE");
                        }}
                        style={{ color: "red" }}
                      >
                        Deletar
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
