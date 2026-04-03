"use client";

import { useEffect, useState, useRef, useCallback, Component } from "react";
import type { ReactNode } from "react";

// Error boundary to catch and display the actual error
class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error: `${error.message}\n\n${error.stack}` };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "2rem", fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
          <h1 style={{ color: "red" }}>Chat Error</h1>
          <p>{this.state.error}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

function ChatInner() {
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  if (!ready) return <p style={{ padding: "2rem" }}>Loading...</p>;
  return <p style={{ padding: "2rem" }}>Chat loaded OK - no crash</p>;
}

export default function ChatPage() {
  return (
    <ErrorBoundary>
      <ChatInner />
    </ErrorBoundary>
  );
}
