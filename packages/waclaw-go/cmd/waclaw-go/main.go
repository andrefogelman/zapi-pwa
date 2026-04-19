// Command waclaw-go is the multi-tenant WhatsApp gateway daemon.
// It embeds go.mau.fi/whatsmeow, persists state in SQLite (FTS5 enabled),
// and exposes an HTTP + SSE API compatible with the old waclaw Node service.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/andrefogelman/zapi-pwa/packages/waclaw-go/internal/config"
	waevents "github.com/andrefogelman/zapi-pwa/packages/waclaw-go/internal/events"
	"github.com/andrefogelman/zapi-pwa/packages/waclaw-go/internal/httpserver"
	"github.com/andrefogelman/zapi-pwa/packages/waclaw-go/internal/scheduler"
	"github.com/andrefogelman/zapi-pwa/packages/waclaw-go/internal/session"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

func main() {
	cfg, err := config.FromEnv()
	if err != nil {
		fmt.Fprintf(os.Stderr, "config error: %v\n", err)
		os.Exit(2)
	}

	setupLogger(cfg)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	log.Info().
		Str("bind_host", cfg.BindHost).
		Int("port", cfg.Port).
		Str("sessions_dir", cfg.SessionsDir).
		Int("media_workers", cfg.MediaDownloadWorkers).
		Msg("waclaw-go starting")

	if err := run(ctx, cfg); err != nil {
		log.Error().Err(err).Msg("run returned error")
		os.Exit(1)
	}

	log.Info().Msg("waclaw-go exited cleanly")
}

// run is the main loop. Creates the event bus, media job channel, session
// manager, and media queue runner, then blocks until ctx is cancelled.
func run(ctx context.Context, cfg config.Config) error {
	bus := waevents.NewBus()

	mediaJobs := make(chan session.MediaJob, 20000)

	mediaBaseURL := fmt.Sprintf("http://%s:%d", localHostOrBind(cfg), cfg.Port)

	handlerDeps := session.HandlerDeps{
		Bus:          bus,
		MediaQueue:   mediaJobs,
		MediaBaseURL: mediaBaseURL,
	}

	mgr, err := session.NewManager(cfg.SessionsDir, log.Logger, handlerDeps)
	if err != nil {
		return fmt.Errorf("new manager: %w", err)
	}
	defer mgr.ShutdownAll(ctx)

	mqRunner := session.NewMediaQueueRunner(mediaJobs, mgr, cfg.MediaDownloadWorkers)
	mqRunner.Start(ctx)

	sessions := mgr.List()
	log.Info().Int("sessions", len(sessions)).Msg("manager ready")

	// Auto-connect ONLY sessions that have completed QR pairing in the past.
	// Unpaired sessions (leftover directories, failed pairings, etc.) are
	// left in StateNew until an explicit POST /sessions/:id/auth. Requesting
	// fresh QR codes for all of them on startup triggers WhatsApp abuse
	// throttles ("cannot connect new devices right now").
	var paired, skipped int
	for _, s := range sessions {
		if !s.IsPaired() {
			skipped++
			log.Info().Str("session", s.ID[:8]).Msg("skipping auto-connect: unpaired")
			continue
		}
		paired++
		go func(s *session.Session) {
			if err := s.Connect(ctx); err != nil {
				log.Error().Err(err).Str("session", s.ID[:8]).Msg("auto-connect failed")
			}
		}(s)
	}
	log.Info().Int("paired", paired).Int("skipped_unpaired", skipped).Msg("auto-connect complete")

	srv := httpserver.New(
		fmt.Sprintf("%s:%d", cfg.BindHost, cfg.Port),
		httpserver.Deps{
			Manager: mgr,
			Bus:     bus,
			Log:     log.Logger,
			APIKey:  cfg.APIKey,
		},
	)

	if sched := scheduler.New(mgr, cfg.SupabaseURL, cfg.SupabaseServiceKey, log.Logger); sched != nil {
		go sched.Run(ctx)
	}

	return srv.Run(ctx)
}

// localHostOrBind returns "localhost" when BindHost is "0.0.0.0" or empty
// (i.e. listening on all interfaces), so that self-referential URLs (like
// media download links embedded in wire events) point to a reachable address.
func localHostOrBind(cfg config.Config) string {
	if cfg.BindHost == "" || cfg.BindHost == "0.0.0.0" {
		return "localhost"
	}
	return cfg.BindHost
}

func setupLogger(cfg config.Config) {
	level, err := zerolog.ParseLevel(cfg.LogLevel)
	if err != nil {
		level = zerolog.InfoLevel
	}
	zerolog.SetGlobalLevel(level)
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnixMicro

	if cfg.LogFormat == "console" {
		log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: "15:04:05.000"})
	}
}
