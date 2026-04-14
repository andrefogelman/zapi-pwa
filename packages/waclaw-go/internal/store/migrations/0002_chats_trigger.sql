-- Auto-populate chats table when messages are inserted.
-- Fixes: messages are stored but chats index stays empty, causing
-- the /chats endpoint to return nothing.
CREATE TRIGGER IF NOT EXISTS chats_from_message AFTER INSERT ON messages
BEGIN
  INSERT INTO chats (jid, kind, name, last_message_ts)
  VALUES (
    NEW.chat_jid,
    CASE WHEN NEW.chat_jid LIKE '%@g.us' THEN 'group'
         WHEN NEW.chat_jid LIKE '%@broadcast' THEN 'broadcast'
         ELSE 'dm'
    END,
    COALESCE(NULLIF(NEW.chat_name, ''), NEW.chat_jid),
    NEW.ts
  )
  ON CONFLICT(jid) DO UPDATE SET
    name = COALESCE(NULLIF(excluded.name, ''), chats.name),
    last_message_ts = CASE
      WHEN excluded.last_message_ts > chats.last_message_ts THEN excluded.last_message_ts
      ELSE chats.last_message_ts
    END;
END;

-- Backfill: populate chats from existing messages already stored.
INSERT INTO chats (jid, kind, name, last_message_ts)
SELECT
  m.chat_jid,
  CASE WHEN m.chat_jid LIKE '%@g.us' THEN 'group'
       WHEN m.chat_jid LIKE '%@broadcast' THEN 'broadcast'
       ELSE 'dm'
  END,
  COALESCE(NULLIF(MAX(m.chat_name), ''), m.chat_jid),
  MAX(m.ts)
FROM messages m
GROUP BY m.chat_jid
ON CONFLICT(jid) DO UPDATE SET
  last_message_ts = CASE
    WHEN excluded.last_message_ts > chats.last_message_ts THEN excluded.last_message_ts
    ELSE chats.last_message_ts
  END;
