-- Add provider choice to instances (waclaw or zapi)
ALTER TABLE public.instances ADD COLUMN provider TEXT NOT NULL DEFAULT 'zapi'
  CHECK (provider IN ('waclaw', 'zapi'));
ALTER TABLE public.instances ADD COLUMN waclaw_session_id TEXT;
