-- Placeholder for legacy migration 20260411105833 that was applied directly on the
-- remote database before this repo tracked migrations via the CLI. The real
-- schema for this version lives in the remote already; this file exists only
-- so supabase db push doesn't complain about the remote/local history
-- mismatch. Do NOT modify. Do NOT run 'supabase db reset' against this repo
-- (it will try to re-apply this as empty, which is a no-op but confusing).
SELECT 1;
