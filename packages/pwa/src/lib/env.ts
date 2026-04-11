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
};
