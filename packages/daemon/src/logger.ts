function ts() {
  return new Date().toISOString();
}

export const log = {
  info: (msg: string, extra: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ ts: ts(), level: "info", msg, ...extra })),
  warn: (msg: string, extra: Record<string, unknown> = {}) =>
    console.warn(JSON.stringify({ ts: ts(), level: "warn", msg, ...extra })),
  error: (msg: string, extra: Record<string, unknown> = {}) =>
    console.error(JSON.stringify({ ts: ts(), level: "error", msg, ...extra })),
};
