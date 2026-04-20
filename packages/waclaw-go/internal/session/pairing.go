package session

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/andrefogelman/zapi-pwa/packages/waclaw-go/internal/store"
	"go.mau.fi/whatsmeow"
	waStoreSQL "go.mau.fi/whatsmeow/store/sqlstore"
	waevt "go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
)

// ensure waLog is referenced so the import stays valid even before Phase 4 fills the handler.
var _ waLog.Logger = (*WACliLogAdapter)(nil)

// Connect opens (or re-uses) the SQLite store, opens a whatsmeow sqlstore
// container on the same file, loads or creates the device, builds a
// whatsmeow.Client, registers the event handler, and calls Connect.
//
// If the device has no JID yet (never paired), Connect will request a QR
// code through client.GetQRChannel. The latest QR string is stored in
// s.lastQR and exposed via LastQR(); callers poll that field (HTTP GET
// /qr) until the user scans.
//
// Idempotent: if already connected, returns nil.
func (s *Session) Connect(ctx context.Context) error {
	s.mu.Lock()
	switch s.state {
	case StateConnected, StateConnecting:
		s.mu.Unlock()
		return nil
	case StateClosed:
		s.mu.Unlock()
		return errClosed
	}
	s.state = StateConnecting
	s.mu.Unlock()

	// Open or re-use the app-level store.
	if s.store == nil {
		st, err := store.Open(filepath.Join(s.StoreDir, "waclaw.db"))
		if err != nil {
			s.fail(fmt.Errorf("store open: %w", err))
			return err
		}
		s.store = st
	}

	// Open whatsmeow sqlstore container on a SEPARATE file (session.db)
	// matching the split used by wacli CLI. This allows devices paired
	// via wacli to be recognized by waclaw-go without re-pairing.
	waLogger := WACliLogAdapter{zl: s.log}
	sessionDBPath := filepath.Join(s.StoreDir, "session.db")
	sessionDSN := fmt.Sprintf("file:%s?_journal=WAL&_busy_timeout=10000&_foreign_keys=on", sessionDBPath)
	container, err := waStoreSQL.New(ctx, "sqlite3", sessionDSN, waLogger.Sub("sqlstore"))
	if err != nil {
		s.fail(fmt.Errorf("whatsmeow sqlstore.New: %w", err))
		return err
	}
	s.container = container

	// Load first device or create new.
	// API adaptation: GetFirstDevice now takes ctx as argument.
	device, err := container.GetFirstDevice(ctx)
	if err != nil {
		s.fail(fmt.Errorf("GetFirstDevice: %w", err))
		return err
	}

	client := whatsmeow.NewClient(device, waLogger.Sub("client"))
	s.client = client
	client.AddEventHandler(s.buildEventHandler())

	if device.ID == nil {
		// Needs pairing.
		qrChan, err := client.GetQRChannel(ctx)
		if err != nil {
			s.fail(fmt.Errorf("GetQRChannel: %w", err))
			return err
		}
		if err := client.Connect(); err != nil {
			s.fail(fmt.Errorf("Connect (pre-QR): %w", err))
			return err
		}
		s.setState(StateWaitingQR)

		go s.watchQR(qrChan)
	} else {
		// Already paired, just connect.
		if err := client.Connect(); err != nil {
			s.fail(fmt.Errorf("Connect: %w", err))
			return err
		}
		// State transitions to StateConnected via the Connected event in
		// the handler (Task 4.5).
	}

	return nil
}

// watchQR drains the QR channel, storing each new QR string until the
// user scans (PairSuccess event in the handler transitions state). Timeout
// comes from the channel being closed by whatsmeow.
func (s *Session) watchQR(qrChan <-chan whatsmeow.QRChannelItem) {
	for item := range qrChan {
		switch item.Event {
		case "code":
			s.log.Info().Msg("new QR code")
			s.setLastQR(item.Code)
		case "success":
			s.log.Info().Msg("QR pairing success")
			s.setLastQR("")
			return
		case "timeout":
			s.log.Warn().Msg("QR pairing timed out")
			s.fail(errors.New("QR pairing timed out"))
			return
		default:
			s.log.Debug().Str("qr_event", item.Event).Msg("QR channel event")
		}
	}
}

func (s *Session) fail(err error) {
	s.mu.Lock()
	s.state = StateDisconnected
	s.lastError = err.Error()
	s.mu.Unlock()
	s.log.Error().Err(err).Msg("session fail")
}

// WaitForConnected blocks until state becomes StateConnected or ctx expires.
// Used by HTTP /auth to return connection status synchronously.
func (s *Session) WaitForConnected(ctx context.Context, timeout time.Duration) error {
	deadline := time.NewTimer(timeout)
	defer deadline.Stop()
	tick := time.NewTicker(200 * time.Millisecond)
	defer tick.Stop()
	for {
		if s.State() == StateConnected {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-deadline.C:
			return errors.New("timeout waiting for connected")
		case <-tick.C:
		}
	}
}

// buildEventHandler returns the whatsmeow event handler that dispatches
// typed whatsmeow events to the appropriate session methods.
func (s *Session) buildEventHandler() func(evt interface{}) {
	return func(evt interface{}) {
		switch v := evt.(type) {
		case *waevt.Message:
			s.handleMessage(v)
		case *waevt.HistorySync:
			s.handleHistorySync(v)
		case *waevt.Connected:
			s.setState(StateConnected)
			s.log.Info().Msg("whatsapp connected")
			// Resolve newsletter names in background after connection.
			go func() {
				n, err := s.ResolveNewsletterNames(context.Background())
				if err != nil {
					s.log.Warn().Err(err).Msg("newsletter name resolve failed")
				} else if n > 0 {
					s.log.Info().Int("resolved", n).Msg("newsletter names updated")
				}
			}()
			// Passive backfill for recently active chats. Runs in background
			// so it doesn't block the event loop. Small N to stay polite.
			go s.passiveBackfillOnConnect(20, 50)
			// Resolve group subjects for groups whose name wasn't captured
			// by history sync (legacy `<phone>-<timestamp>` chat IDs show up
			// as raw JIDs in the UI without this).
			go s.backfillGroupNames(50)
			// Re-enqueue media downloads that were dropped on previous runs
			// when the in-memory queue overflowed during history-sync bursts.
			go s.rehydratePendingDownloads(2000)
		case *waevt.GroupInfo:
			s.handleGroupInfo(v)
		case *waevt.Blocklist:
			s.handleBlocklist(v)
		case *waevt.Disconnected:
			s.setState(StateDisconnected)
			s.log.Info().Msg("whatsapp disconnected")
		case *waevt.LoggedOut:
			s.setState(StateLoggedOut)
			s.log.Warn().Bool("on_connect", v.OnConnect).Msg("whatsapp logged out")
		case *waevt.PushName:
			s.handlePushName(v)
		case *waevt.PairSuccess:
			s.log.Info().Str("jid", v.ID.String()).Msg("pair success")
			s.setState(StateConnected)
		}
	}
}

// IsPaired returns true if the session.db contains a stored whatsmeow device
// (i.e., the session has completed QR pairing at some point in the past).
// Used at startup to skip auto-connect for unpaired leftover session dirs —
// avoiding the "abuse" pattern of requesting multiple fresh QR codes in
// parallel, which WhatsApp throttles with "cannot connect new devices".
//
// Lightweight: opens session.db read-only and does a single COUNT(*).
// Returns false on any error (missing file, corrupt db, etc.) — the safe
// default is "not paired, do not auto-QR".
func (s *Session) IsPaired() bool {
	sessionDBPath := filepath.Join(s.StoreDir, "session.db")
	if _, err := os.Stat(sessionDBPath); err != nil {
		return false
	}
	dsn := fmt.Sprintf("file:%s?mode=ro&_busy_timeout=5000", sessionDBPath)
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return false
	}
	defer db.Close()
	var n int
	if err := db.QueryRow("SELECT COUNT(*) FROM whatsmeow_device").Scan(&n); err != nil {
		return false
	}
	return n > 0
}
