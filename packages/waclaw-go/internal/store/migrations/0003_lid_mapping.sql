-- Add LID (Local Identifier) mapping to contacts/chats/messages.
-- Context: WhatsApp now sends LIDs (`<digits>@lid`) as primary identifier even
-- when users haven't enabled privacy mode. A contact may appear first as
-- `<phone>@s.whatsapp.net` and later as `<digits>@lid`, or vice versa.
-- Without a mapping column we'd create two distinct rows for the same person,
-- fragmenting history and breaking echo-prevention in group chats.
--
-- Strategy:
--   - `jid` remains the PK (stable once stored).
--   - New `lid` column stores the alternate identifier when whatsmeow exposes
--     it (via events.UserInfo / PNJID mapping, or direct LID info on messages).
--   - Lookups happen by (jid OR lid) to unify contacts seen under both forms.

ALTER TABLE contacts ADD COLUMN lid TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_lid ON contacts(lid) WHERE lid IS NOT NULL;

ALTER TABLE chats ADD COLUMN lid TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_chats_lid ON chats(lid) WHERE lid IS NOT NULL;

-- Denormalize LID onto messages for fast echo filtering without joins.
ALTER TABLE messages ADD COLUMN sender_lid TEXT;
ALTER TABLE messages ADD COLUMN chat_lid TEXT;
CREATE INDEX IF NOT EXISTS idx_messages_sender_lid ON messages(sender_lid) WHERE sender_lid IS NOT NULL;
