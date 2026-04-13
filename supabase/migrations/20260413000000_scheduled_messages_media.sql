-- Add optional media attachment fields to waclaw_scheduled_messages.
-- text becomes nullable (either text or media must be present at app level).
ALTER TABLE public.waclaw_scheduled_messages
  ALTER COLUMN text DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS media_filename  TEXT,
  ADD COLUMN IF NOT EXISTS media_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS media_base64    TEXT;
