package config

import (
	"testing"
)

func TestFromEnv_Defaults(t *testing.T) {
	t.Setenv("WACLAW_API_KEY", "test-key")
	// Don't set anything else — defaults should kick in.

	cfg, err := FromEnv()
	if err != nil {
		t.Fatalf("FromEnv: %v", err)
	}

	if cfg.APIKey != "test-key" {
		t.Errorf("APIKey = %q, want test-key", cfg.APIKey)
	}
	if cfg.Port != 3100 {
		t.Errorf("Port = %d, want 3100", cfg.Port)
	}
	if cfg.BindHost != "0.0.0.0" {
		t.Errorf("BindHost = %q, want 0.0.0.0", cfg.BindHost)
	}
	if cfg.SessionsDir == "" {
		t.Errorf("SessionsDir must have a default")
	}
	if cfg.LogLevel != "info" {
		t.Errorf("LogLevel = %q, want info", cfg.LogLevel)
	}
	if cfg.MediaDownloadWorkers != 4 {
		t.Errorf("MediaDownloadWorkers = %d, want 4", cfg.MediaDownloadWorkers)
	}
}

func TestFromEnv_MissingAPIKey(t *testing.T) {
	t.Setenv("WACLAW_API_KEY", "")
	_, err := FromEnv()
	if err == nil {
		t.Fatal("expected error when WACLAW_API_KEY is empty")
	}
}

func TestFromEnv_CustomPort(t *testing.T) {
	t.Setenv("WACLAW_API_KEY", "k")
	t.Setenv("PORT", "4200")
	cfg, err := FromEnv()
	if err != nil {
		t.Fatalf("FromEnv: %v", err)
	}
	if cfg.Port != 4200 {
		t.Errorf("Port = %d, want 4200", cfg.Port)
	}
}

func TestFromEnv_BadPort(t *testing.T) {
	t.Setenv("WACLAW_API_KEY", "k")
	t.Setenv("PORT", "not-a-number")
	_, err := FromEnv()
	if err == nil {
		t.Fatal("expected error on invalid PORT")
	}
}
