"use client";

import { useAuth } from "@/lib/use-auth";
import { useRouter } from "next/navigation";
import "./whatsapp.css";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#f0f2f5" }}>
        <div style={{ textAlign: "center", color: "#667781" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>💬</div>
          Carregando...
        </div>
      </div>
    );
  }

  if (!user) {
    router.push("/login");
    return null;
  }

  return <>{children}</>;
}
