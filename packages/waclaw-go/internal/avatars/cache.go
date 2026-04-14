// Package avatars provides helpers for the on-disk avatar JPEG cache.
// Avatars are stored as {storeDir}/avatars/{sanitizedJid}.jpg where
// sanitizedJid replaces every non-alphanumeric character with '_'.
package avatars

import (
	"os"
	"path/filepath"
	"regexp"
)

var nonAlnum = regexp.MustCompile(`[^a-zA-Z0-9]`)

// sanitized replaces every non-alphanumeric character in jid with '_'.
func sanitized(jid string) string {
	return nonAlnum.ReplaceAllString(jid, "_")
}

// Path returns the absolute path to the cached avatar JPEG for a JID.
func Path(storeDir, jid string) string {
	return filepath.Join(storeDir, "avatars", sanitized(jid)+".jpg")
}

// Exists reports whether the avatar file is present in the cache.
func Exists(storeDir, jid string) bool {
	_, err := os.Stat(Path(storeDir, jid))
	return err == nil
}

// EnsureDir creates the avatars sub-directory if it does not exist.
func EnsureDir(storeDir string) error {
	return os.MkdirAll(filepath.Join(storeDir, "avatars"), 0o755)
}

// Save writes avatar data to the cache directory for a JID.
func Save(storeDir, jid string, data []byte) error {
	if err := EnsureDir(storeDir); err != nil {
		return err
	}
	return os.WriteFile(Path(storeDir, jid), data, 0o644)
}
