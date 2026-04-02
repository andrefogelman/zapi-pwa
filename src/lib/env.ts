function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export const env = {
  get OPENAI_API_KEY() { return required("OPENAI_API_KEY"); },
  get SUPABASE_URL() { return required("SUPABASE_URL"); },
  get SUPABASE_SERVICE_ROLE_KEY() { return required("SUPABASE_SERVICE_ROLE_KEY"); },
  get WACLI_API_URL() { return required("WACLI_API_URL"); },
  get WACLI_API_TOKEN() { return required("WACLI_API_TOKEN"); },
};
