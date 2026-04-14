// Package config centralizes environment-based configuration.
// All env vars and their defaults live here so main.go stays small.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
)

// Config holds runtime configuration. Immutable after FromEnv() returns.
type Config struct {
	// HTTP
	APIKey   string
	Port     int
	BindHost string

	// Storage
	SessionsDir string

	// Logging
	LogLevel  string
	LogFormat string

	// Supabase (scheduler)
	SupabaseURL        string
	SupabaseServiceKey string

	// Media
	MediaDownloadWorkers int
	MaxAudioBytes        int64
}

const (
	defaultPort          = 3100
	defaultBindHost      = "0.0.0.0"
	defaultSessionsDir   = "/home/orcabot/waclaw-go/sessions"
	defaultLogLevel      = "info"
	defaultLogFormat     = "json"
	defaultMediaWorkers  = 4
	defaultMaxAudioBytes = 25 * 1024 * 1024 // 25 MiB, matches zapi-shared
)

// FromEnv reads all configuration from environment variables.
// Returns an error if any required value is missing or malformed.
func FromEnv() (Config, error) {
	cfg := Config{
		APIKey:             os.Getenv("WACLAW_API_KEY"),
		BindHost:           getEnvDefault("BIND_HOST", defaultBindHost),
		SessionsDir:        getEnvDefault("SESSIONS_DIR", defaultSessionsDir),
		LogLevel:           getEnvDefault("LOG_LEVEL", defaultLogLevel),
		LogFormat:          getEnvDefault("LOG_FORMAT", defaultLogFormat),
		SupabaseURL:        os.Getenv("SUPABASE_URL"),
		SupabaseServiceKey: os.Getenv("SUPABASE_SERVICE_ROLE_KEY"),
	}

	if cfg.APIKey == "" {
		return Config{}, errors.New("WACLAW_API_KEY must be set")
	}

	port, err := parseIntDefault("PORT", defaultPort)
	if err != nil {
		return Config{}, err
	}
	cfg.Port = port

	workers, err := parseIntDefault("MEDIA_DOWNLOAD_WORKERS", defaultMediaWorkers)
	if err != nil {
		return Config{}, err
	}
	if workers < 1 {
		workers = 1
	}
	cfg.MediaDownloadWorkers = workers

	maxAudio, err := parseInt64Default("MAX_AUDIO_BYTES", defaultMaxAudioBytes)
	if err != nil {
		return Config{}, err
	}
	cfg.MaxAudioBytes = maxAudio

	return cfg, nil
}

func getEnvDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func parseIntDefault(key string, def int) (int, error) {
	raw := os.Getenv(key)
	if raw == "" {
		return def, nil
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("env %s: %w", key, err)
	}
	return v, nil
}

func parseInt64Default(key string, def int64) (int64, error) {
	raw := os.Getenv(key)
	if raw == "" {
		return def, nil
	}
	v, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("env %s: %w", key, err)
	}
	return v, nil
}
