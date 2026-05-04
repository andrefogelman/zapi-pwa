ALTER TABLE instances
  ADD COLUMN IF NOT EXISTS transcription_enabled boolean NOT NULL DEFAULT true;
