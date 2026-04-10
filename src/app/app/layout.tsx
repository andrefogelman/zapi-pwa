"use client";

import { useAuth } from "@/lib/use-auth";
import { useRouter } from "next/navigation";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
        Carregando...
      </div>
    );
  }

  if (!user) {
    router.push("/login");
    return null;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* Top bar */}
      <header style={{
        background: "#075e54", color: "#fff", padding: "0.5rem 1rem",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span style={{ fontWeight: 600 }}>Transcritor</span>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <a href="/app/instances" style={{ color: "#fff", textDecoration: "none", fontSize: "0.9rem" }}>
            Instâncias
          </a>
          <a href="/app/chat" style={{ color: "#fff", textDecoration: "none", fontSize: "0.9rem" }}>
            Conversas
          </a>
          <button
            onClick={() => { signOut(); router.push("/login"); }}
            style={{ background: "none", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", padding: "0.3rem 0.75rem", borderRadius: 4, cursor: "pointer", fontSize: "0.85rem" }}
          >
            Sair
          </button>
        </div>
      </header>

      {/* Content */}
      <main style={{ flex: 1, overflow: "auto" }}>
        {children}
      </main>
    </div>
  );
}
