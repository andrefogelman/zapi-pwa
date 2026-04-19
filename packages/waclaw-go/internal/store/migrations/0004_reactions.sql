-- Reactions to messages. One row per (target message, reactor).
-- When the reactor changes or removes their reaction, we upsert by
-- (chat_jid, target_msg_id, reactor_jid) and either overwrite `emoji`
-- or set it to '' to signal removal. Readers filter emoji != '' when
-- rendering aggregated chips.

CREATE TABLE IF NOT EXISTS reactions (
  chat_jid       TEXT NOT NULL,
  target_msg_id  TEXT NOT NULL,
  reactor_jid    TEXT NOT NULL,
  reactor_lid    TEXT,
  emoji          TEXT NOT NULL,
  ts             INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (chat_jid, target_msg_id, reactor_jid)
);

CREATE INDEX IF NOT EXISTS reactions_by_target
  ON reactions (chat_jid, target_msg_id)
  WHERE emoji != '';
