package main

import (
	"crypto/rand"
	"encoding/hex"
	"strings"
)

func newID() string {
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return hex.EncodeToString([]byte("fallback-session-id"))
	}
	return hex.EncodeToString(buf[:])
}

func normalizeID(value string) string {
	return strings.TrimSpace(value)
}
