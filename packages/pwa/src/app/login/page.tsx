"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/use-auth";

export default function LoginPage() {
  const { signInWithGoogle, signInWithEmail } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const { error } = await signInWithEmail(email, password);
    if (error) {
      setError(error.message);
    } else {
      router.push("/app");
    }
  }

  return (
    <main style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      minHeight: "100vh", background: "#f0f2f5",
    }}>
      <div style={{
        background: "#fff", borderRadius: 8, padding: "2rem",
        width: 360, boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
      }}>
        <h1 style={{ fontSize: "1.25rem", marginBottom: "1.5rem", textAlign: "center" }}>
          falabem
        </h1>

        <button
          onClick={signInWithGoogle}
          style={{
            width: "100%", padding: "0.75rem", marginBottom: "1rem",
            background: "#4285f4", color: "#fff", border: "none",
            borderRadius: 4, cursor: "pointer", fontSize: "0.95rem",
          }}
        >
          Entrar com Google
        </button>

        <div style={{ textAlign: "center", margin: "0.75rem 0", color: "#999", fontSize: "0.85rem" }}>
          ou
        </div>

        <form onSubmit={handleEmailLogin}>
          <input
            type="email" placeholder="Email" value={email}
            onChange={(e) => setEmail(e.target.value)} required
            style={{ display: "block", width: "100%", padding: "0.6rem", marginBottom: "0.5rem", boxSizing: "border-box" }}
          />
          <input
            type="password" placeholder="Senha" value={password}
            onChange={(e) => setPassword(e.target.value)} required
            style={{ display: "block", width: "100%", padding: "0.6rem", marginBottom: "0.75rem", boxSizing: "border-box" }}
          />
          <button type="submit" style={{
            width: "100%", padding: "0.75rem", background: "#075e54",
            color: "#fff", border: "none", borderRadius: 4, cursor: "pointer",
          }}>
            Entrar
          </button>
          {error && <p style={{ color: "red", fontSize: "0.85rem", marginTop: "0.5rem" }}>{error}</p>}
        </form>
      </div>
    </main>
  );
}
