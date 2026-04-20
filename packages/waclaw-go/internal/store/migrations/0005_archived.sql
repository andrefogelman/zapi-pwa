-- Mark archived chats so we can hide them from the normal chat list.
-- Populated from the history-sync Conversation.archived flag.

ALTER TABLE chats ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
