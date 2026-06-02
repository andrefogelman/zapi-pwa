-- F4: per-instance daily-report phone, scheduled-message recurrence, and
-- multi-tenant scoping for the group monitor.

-- 1. Per-instance report destination (replaces transcriber's zapi_config.report_phone).
ALTER TABLE "public"."instances"
  ADD COLUMN IF NOT EXISTS "report_phone" "text";

-- 2. Recurrence on waclaw_scheduled_messages (ported from transcriber scheduled_messages).
--    pattern: 'daily' | 'weekly' | 'monthly'; days = weekday list (0=Sun..6=Sat) for weekly.
ALTER TABLE "public"."waclaw_scheduled_messages"
  ADD COLUMN IF NOT EXISTS "recurrence_pattern" "text",
  ADD COLUMN IF NOT EXISTS "recurrence_interval" integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "recurrence_days" integer[],
  ADD COLUMN IF NOT EXISTS "recurrence_end_date" timestamp with time zone;

-- 3. Tenant scoping for the group monitor (group_messages came from the
--    single-tenant transcriber; the unified app scopes per instance).
ALTER TABLE "public"."group_messages"
  ADD COLUMN IF NOT EXISTS "instance_id" "uuid";
