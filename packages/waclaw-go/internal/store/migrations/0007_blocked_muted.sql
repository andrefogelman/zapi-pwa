-- 0007: per-contact block state and per-chat mute until timestamp.
-- blocked mirrors the WhatsApp blocklist (synced across devices via whatsmeow
-- UpdateBlocklist). muted_until is a unix timestamp; 0 = unmuted,
-- LONG_MAX = muted forever.

ALTER TABLE contacts ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chats ADD COLUMN muted_until INTEGER NOT NULL DEFAULT 0;
