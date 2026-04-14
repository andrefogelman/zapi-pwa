package session

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/andrefogelman/zapi-pwa/packages/waclaw-go/internal/store"
	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

// Manager orchestrates multiple Sessions. One process per deployment,
// N sessions live in-memory, each with its own store directory.
type Manager struct {
	sessionsRoot string
	log          zerolog.Logger

	mu       sync.RWMutex
	sessions map[string]*Session

	handlerDeps HandlerDeps
}

// NewManager reads existing session directories from sessionsRoot and
// rehydrates each one as a Session in state "new" (not yet connected).
// Callers should then call ConnectAll or per-session Connect to bring
// them online.
func NewManager(sessionsRoot string, log zerolog.Logger, handlerDeps HandlerDeps) (*Manager, error) {
	if err := os.MkdirAll(sessionsRoot, 0o700); err != nil {
		return nil, fmt.Errorf("mkdir sessions root: %w", err)
	}
	m := &Manager{
		sessionsRoot: sessionsRoot,
		log:          log,
		sessions:     make(map[string]*Session),
		handlerDeps:  handlerDeps,
	}
	if err := m.loadExisting(); err != nil {
		return nil, err
	}
	return m, nil
}

// loadExisting scans sessionsRoot for existing session directories.
// Each directory name is treated as a session ID; the Store is opened
// lazily on demand (Task 3.4 connects).
func (m *Manager) loadExisting() error {
	entries, err := os.ReadDir(m.sessionsRoot)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		id := e.Name()
		dir := filepath.Join(m.sessionsRoot, id)
		sess := &Session{
			ID:          id,
			StoreDir:    dir,
			log:         m.log.With().Str("session", id[:8]).Logger(),
			state:       StateNew,
			handlerDeps: m.handlerDeps,
		}
		m.sessions[id] = sess
		m.log.Info().Str("session", id[:8]).Msg("loaded existing session dir")
	}
	return nil
}

// Create makes a brand-new session: generates UUID, creates dir, opens store.
// Returns (*Session, nil) on success.
func (m *Manager) Create(ctx context.Context) (*Session, error) {
	id := uuid.New().String()
	dir := filepath.Join(m.sessionsRoot, id)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("mkdir session dir: %w", err)
	}

	st, err := store.Open(filepath.Join(dir, "waclaw.db"))
	if err != nil {
		return nil, fmt.Errorf("open store: %w", err)
	}

	sess := &Session{
		ID:          id,
		StoreDir:    dir,
		log:         m.log.With().Str("session", id[:8]).Logger(),
		state:       StateNew,
		store:       st,
		handlerDeps: m.handlerDeps,
	}

	m.mu.Lock()
	m.sessions[id] = sess
	m.mu.Unlock()

	m.log.Info().Str("session", id[:8]).Msg("session created")
	return sess, nil
}

// Get returns the session for an ID or an error if not found.
func (m *Manager) Get(id string) (*Session, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s, ok := m.sessions[id]
	if !ok {
		return nil, errors.New("session not found")
	}
	return s, nil
}

// List returns a snapshot of all sessions.
func (m *Manager) List() []*Session {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]*Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		out = append(out, s)
	}
	return out
}

// Delete disconnects and removes a session, including its store dir.
func (m *Manager) Delete(ctx context.Context, id string) error {
	m.mu.Lock()
	sess, ok := m.sessions[id]
	if !ok {
		m.mu.Unlock()
		return errors.New("session not found")
	}
	delete(m.sessions, id)
	m.mu.Unlock()

	if err := sess.Close(); err != nil {
		m.log.Warn().Err(err).Str("session", id[:8]).Msg("close during delete")
	}
	if err := os.RemoveAll(sess.StoreDir); err != nil {
		return fmt.Errorf("remove dir: %w", err)
	}
	return nil
}

// ShutdownAll disconnects every session. Called during graceful shutdown.
func (m *Manager) ShutdownAll(ctx context.Context) {
	m.mu.RLock()
	all := make([]*Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		all = append(all, s)
	}
	m.mu.RUnlock()

	var wg sync.WaitGroup
	for _, s := range all {
		wg.Add(1)
		go func(s *Session) {
			defer wg.Done()
			done := make(chan struct{})
			go func() {
				_ = s.Close()
				close(done)
			}()
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				m.log.Warn().Str("session", s.ID[:8]).Msg("close timeout")
			}
		}(s)
	}
	wg.Wait()
}
