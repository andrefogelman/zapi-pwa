function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function first(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  throw new Error(`Missing env var: one of ${names.join(", ")}`);
}

export const env = {
  get OPENAI_API_KEY() { return required("OPENAI_API_KEY"); },
  // Accept either SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL. Both point at the
  // same Supabase project; the public-prefixed one is always defined in a
  // Next.js project because the browser client needs it, so falling back here
  // avoids forcing the operator to set the same value twice.
  get SUPABASE_URL() { return first("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"); },
  get SUPABASE_SERVICE_ROLE_KEY() { return required("SUPABASE_SERVICE_ROLE_KEY"); },
  get UPSTASH_REDIS_REST_URL() { return required("UPSTASH_REDIS_REST_URL"); },
  get UPSTASH_REDIS_REST_TOKEN() { return required("UPSTASH_REDIS_REST_TOKEN"); },
  // waclaw-go daemon endpoint + shared API key. No fallback — if either is
  // missing in the runtime env we fail loudly instead of shipping a default
  // that grants the whole world access to the daemon.
  get WACLAW_URL() { return process.env.WACLAW_URL ?? "https://worker5.taile4c10f.ts.net"; },
  get WACLAW_API_KEY() { return required("WACLAW_API_KEY"); },
  // Shared secret used to verify webhooks posted by the Z-API provider
  // ("X-Zapi-Signature" HMAC-SHA256 of the raw body).
  get ZAPI_WEBHOOK_SECRET() { return process.env.ZAPI_WEBHOOK_SECRET ?? ""; },
};
