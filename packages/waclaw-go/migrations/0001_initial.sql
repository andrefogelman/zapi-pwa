-- Replica exata do schema app-level do wacli.db existente em /home/orcabot/.wacli/.
-- Extraído via `sqlite3 wacli.db .schema` em 2026-04-11.
-- As tabelas whatsmeow_* são criadas automaticamente pelo pacote
-- go.mau.fi/whatsmeow/store/sqlstore na primeira conexão — não estão aqui.

CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
    jid             TEXT PRIMARY KEY,
    kind            TEXT NOT NULL, -- dm | group | broadcast | unknown
    name            TEXT,
    last_message_ts INTEGER
);

CREATE TABLE IF NOT EXISTS contacts (
    jid           TEXT PRIMARY KEY,
    phone         TEXT,
    push_name     TEXT,
    full_name     TEXT,
    first_name    TEXT,
    business_name TEXT,
    updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
    jid        TEXT PRIMARY KEY,
    name       TEXT,
    owner_jid  TEXT,
    created_ts INTEGER,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_participants (
    group_jid  TEXT NOT NULL,
    user_jid   TEXT NOT NULL,
    role       TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (group_jid, user_jid),
    FOREIGN KEY (group_jid) REFERENCES groups(jid) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS contact_aliases (
    jid        TEXT PRIMARY KEY,
    alias      TEXT NOT NULL,
    notes      TEXT,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS contact_tags (
    jid        TEXT NOT NULL,
    tag        TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (jid, tag)
);

CREATE TABLE IF NOT EXISTS messages (
    rowid           INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_jid        TEXT NOT NULL,
    chat_name       TEXT,
    msg_id          TEXT NOT NULL,
    sender_jid      TEXT,
    sender_name     TEXT,
    ts              INTEGER NOT NULL,
    from_me         INTEGER NOT NULL,
    text            TEXT,
    display_text    TEXT,
    media_type      TEXT,
    media_caption   TEXT,
    filename        TEXT,
    mime_type       TEXT,
    direct_path     TEXT,
    media_key       BLOB,
    file_sha256     BLOB,
    file_enc_sha256 BLOB,
    file_length     INTEGER,
    local_path      TEXT,
    downloaded_at   INTEGER,
    UNIQUE (chat_jid, msg_id),
    FOREIGN KEY (chat_jid) REFERENCES chats(jid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages(chat_jid, ts);
CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(ts);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    text,
    media_caption,
    filename,
    chat_name,
    sender_name,
    display_text
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, text, media_caption, filename, chat_name, sender_name, display_text)
    VALUES (new.rowid,
        COALESCE(new.text, ''),
        COALESCE(new.media_caption, ''),
        COALESCE(new.filename, ''),
        COALESCE(new.chat_name, ''),
        COALESCE(new.sender_name, ''),
        COALESCE(new.display_text, ''));
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
    DELETE FROM messages_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
    DELETE FROM messages_fts WHERE rowid = old.rowid;
    INSERT INTO messages_fts(rowid, text, media_caption, filename, chat_name, sender_name, display_text)
    VALUES (new.rowid,
        COALESCE(new.text, ''),
        COALESCE(new.media_caption, ''),
        COALESCE(new.filename, ''),
        COALESCE(new.chat_name, ''),
        COALESCE(new.sender_name, ''),
        COALESCE(new.display_text, ''));
END;
