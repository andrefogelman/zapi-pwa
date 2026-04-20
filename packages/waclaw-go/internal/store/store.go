// Package store owns the SQLite persistence layer. One Store per tenant
// session directory; each contains both the app-level schema (chats,
// messages, messages_fts, ...) and the whatsmeow_* tables managed by
// go.mau.fi/whatsmeow/store/sqlstore.
//
// Build MUST include -tags sqlite_fts5 — the FTS5 virtual table depends
// on the sqlite3 library compiled with FTS5 enabled.
package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"

	_ "github.com/mattn/go-sqlite3"
)

// Store wraps a single SQLite database connection. Methods on Store are
// safe for concurrent use — sql.DB is safe for concurrent use by default
// and mattn/go-sqlite3 serializes writes internally.
type Store struct {
	db  *sql.DB
	dsn string
}

// Open creates or opens a SQLite database at path, enables WAL and
// foreign keys, and applies the app-level migrations.
// The whatsmeow_* tables are created later, when a whatsmeow container
// is opened against the same file.
func Open(path string) (*Store, error) {
	if path == "" {
		return nil, errors.New("store path is empty")
	}
	dsn := fmt.Sprintf("file:%s?_journal=WAL&_busy_timeout=10000&_foreign_keys=off", path)
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, fmt.Errorf("sql.Open: %w", err)
	}
	// Keep a small pool — SQLite is single-writer.
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(2)

	s := &Store{db: db, dsn: dsn}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

// Close releases the underlying database handle.
func (s *Store) Close() error {
	return s.db.Close()
}

// DB exposes the raw handle for packages that need to hand it to
// whatsmeow/store/sqlstore. External callers should prefer the typed
// methods on Store.
func (s *Store) DB() *sql.DB {
	return s.db
}

// DSN returns the connection string used to open this store. Used by the
// session package to open a whatsmeow sqlstore container on the same file.
func (s *Store) DSN() string {
	return s.dsn
}

func (s *Store) migrate() error {
	// 0001 MUST run before 0002: 0002 defines a trigger on the messages
	// table and backfills chats from messages, both of which require 0001
	// to have created the messages table first.
	if _, err := s.db.Exec(migration0001); err != nil {
		return err
	}
	if _, err := s.db.Exec(
		`INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, strftime('%s','now'))`,
		1, "0001_initial",
	); err != nil {
		return err
	}

	if _, err := s.db.Exec(migration0002); err != nil {
		return err
	}
	if _, err := s.db.Exec(
		`INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, strftime('%s','now'))`,
		2, "0002_chats_trigger",
	); err != nil {
		return err
	}

	// 0003 uses ALTER TABLE statements. mattn/go-sqlite3's db.Exec only runs
	// the first statement in a multi-statement string, so we split on ';'
	// and execute each non-empty statement individually.
	if err := s.execMultiStatement(migration0003); err != nil {
		return fmt.Errorf("apply 0003: %w", err)
	}
	if _, err := s.db.Exec(
		`INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, strftime('%s','now'))`,
		3, "0003_lid_mapping",
	); err != nil {
		return err
	}

	if err := s.execMultiStatement(migration0004); err != nil {
		return fmt.Errorf("apply 0004: %w", err)
	}
	if _, err := s.db.Exec(
		`INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, strftime('%s','now'))`,
		4, "0004_reactions",
	); err != nil {
		return err
	}

	if err := s.execMultiStatement(migration0005); err != nil {
		return fmt.Errorf("apply 0005: %w", err)
	}
	if _, err := s.db.Exec(
		`INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, strftime('%s','now'))`,
		5, "0005_archived",
	); err != nil {
		return err
	}

	if err := s.execMultiStatement(migration0006); err != nil {
		return fmt.Errorf("apply 0006: %w", err)
	}
	_, err := s.db.Exec(
		`INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, strftime('%s','now'))`,
		6, "0006_chat_flags",
	)
	return err
}

// execMultiStatement splits SQL on semicolons and executes each non-empty
// statement separately. ALTER TABLE ADD COLUMN fails with "duplicate column
// name" on re-run, which is swallowed so migrations are idempotent.
func (s *Store) execMultiStatement(sqlText string) error {
	for _, raw := range strings.Split(sqlText, ";") {
		stmt := stripSQLComments(raw)
		if stmt == "" {
			continue
		}
		if _, err := s.db.Exec(stmt); err != nil {
			if strings.Contains(err.Error(), "duplicate column name") {
				continue
			}
			return err
		}
	}
	return nil
}

func stripSQLComments(s string) string {
	var b strings.Builder
	for _, line := range strings.Split(s, "\n") {
		if strings.HasPrefix(strings.TrimLeft(line, " \t"), "--") {
			continue
		}
		b.WriteString(line)
		b.WriteByte('\n')
	}
	return strings.TrimSpace(b.String())
}
