-- Per-chat flags exposed through the WhatsApp context menu: pin to top,
-- mark as unread (manual re-flag overriding last_message_ts).

ALTER TABLE chats ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chats ADD COLUMN manual_unread INTEGER NOT NULL DEFAULT 0;
