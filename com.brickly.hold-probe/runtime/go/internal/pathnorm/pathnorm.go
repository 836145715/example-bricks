package pathnorm

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

var (
	ErrEmpty       = errors.New("path is empty")
	ErrRelative    = errors.New("path must be absolute")
	ErrInvalid     = errors.New("path is invalid")
	ErrNotFound    = errors.New("path not found")
	ErrAccess      = errors.New("access denied")
	ErrUnsupported = errors.New("path type not supported")
)

type Kind string

const (
	KindFile Kind = "file"
	KindDir  Kind = "directory"
)

type Target struct {
	Path string `json:"path"`
	Kind Kind   `json:"kind"`
}

func Normalize(raw string) (Target, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return Target{}, ErrEmpty
	}
	if strings.IndexByte(raw, 0) >= 0 {
		return Target{}, ErrInvalid
	}
	if !filepath.IsAbs(raw) {
		return Target{}, ErrRelative
	}

	clean := filepath.Clean(raw)
	info, err := os.Stat(clean)
	if err != nil {
		switch {
		case errors.Is(err, fs.ErrNotExist):
			return Target{}, fmt.Errorf("%w: %s", ErrNotFound, clean)
		case errors.Is(err, fs.ErrPermission):
			return Target{}, fmt.Errorf("%w: %s", ErrAccess, clean)
		default:
			if isInvalidPath(err) {
				return Target{}, fmt.Errorf("%w: %s", ErrInvalid, clean)
			}
			return Target{}, fmt.Errorf("stat %s: %w", clean, err)
		}
	}

	switch {
	case info.Mode().IsRegular():
		return Target{Path: clean, Kind: KindFile}, nil
	case info.IsDir():
		return Target{Path: clean, Kind: KindDir}, nil
	default:
		return Target{}, fmt.Errorf("%w: %s", ErrUnsupported, clean)
	}
}
