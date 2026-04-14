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
	_, err := s.db.Exec(
		`INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, strftime('%s','now'))`,
		2, "0002_chats_trigger",
	)
	return err
}
