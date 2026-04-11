import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "sans-serif" }}>
      <aside
        style={{
          width: 220,
          background: "#1a1a1a",
          color: "#fff",
          padding: "1.5rem 1rem",
        }}
      >
        <h1 style={{ fontSize: "1.1rem", marginBottom: "2rem" }}>zapi-pwa admin</h1>
        <nav style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <Link href="/admin" style={linkStyle}>Dashboard</Link>
          <Link href="/admin/users" style={linkStyle}>Usuários</Link>
          <Link href="/admin/neura" style={linkStyle}>Neura</Link>
          <Link href="/app" style={{ ...linkStyle, marginTop: "2rem", opacity: 0.6 }}>
            ← Voltar ao chat
          </Link>
        </nav>
      </aside>
      <main style={{ flex: 1, padding: "2rem 3rem", background: "#f5f5f5" }}>
        {children}
      </main>
    </div>
  );
}

const linkStyle = {
  color: "#fff",
  textDecoration: "none",
  padding: "0.5rem 0.75rem",
  borderRadius: 4,
};
