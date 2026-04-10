"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "./supabase-browser";
import type { User, Session } from "@supabase/supabase-js";

const supabase = getSupabaseBrowser();

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWithGoogle = () =>
    supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // Route lives at /callback (route group `(auth)` doesn't add a URL segment)
        redirectTo: `${window.location.origin}/callback`,
        // Request the People API contacts scope so we can read the user's
        // Google Contacts client-side via session.provider_token.
        scopes: "https://www.googleapis.com/auth/contacts.readonly",
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });

  const signInWithEmail = (email: string, password: string) =>
    supabase.auth.signInWithPassword({ email, password });

  const signOut = () => supabase.auth.signOut();

  return { user, session, loading, signInWithGoogle, signInWithEmail, signOut };
}
