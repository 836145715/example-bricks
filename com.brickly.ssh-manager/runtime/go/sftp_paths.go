package main

import (
	"path"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

func normalizeRemotePath(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", nil
	}
	if strings.ContainsRune(value, 0) {
		return "", newInputError("invalid remote path")
	}
	if looksLikeWindowsPath(value) {
		return "", newInputError("invalid remote path")
	}
	value = strings.ReplaceAll(value, "\\", "/")
	if !utf8.ValidString(value) {
		return "", newInputError("invalid remote path")
	}
	return value, nil
}

func looksLikeWindowsPath(value string) bool {
	if len(value) >= 2 && value[1] == ':' {
		drive := value[0]
		if drive >= 'A' && drive <= 'Z' || drive >= 'a' && drive <= 'z' {
			return true
		}
	}
	return strings.HasPrefix(value, "\\\\")
}

func joinRemote(dir, name string) string {
	dir = strings.TrimSpace(dir)
	name = strings.Trim(strings.ReplaceAll(name, "\\", "/"), "/")
	if name == "" {
		if dir == "" {
			return "/"
		}
		return dir
	}
	if dir == "" || dir == "/" {
		return "/" + name
	}
	return strings.TrimRight(dir, "/") + "/" + name
}

func remoteBase(remotePath string) string {
	cleaned := path.Clean(strings.ReplaceAll(remotePath, "\\", "/"))
	base := path.Base(cleaned)
	if base == "." || base == "/" {
		return ""
	}
	return base
}

func remoteParent(remotePath string) string {
	cleaned := path.Clean(strings.ReplaceAll(remotePath, "\\", "/"))
	parent := path.Dir(cleaned)
	if parent == "." {
		return "/"
	}
	return parent
}

func confineLocal(localDir, name string) (string, error) {
	if strings.TrimSpace(localDir) == "" {
		return "", newInputError("localDir is required")
	}
	if strings.ContainsRune(name, 0) || strings.Contains(name, "..") && path.Clean("/"+name) == "/" {
		return "", newInputError("invalid download name")
	}
	cleanDir := filepath.Clean(localDir)
	dest := filepath.Clean(filepath.Join(cleanDir, filepath.FromSlash(name)))
	rel, err := filepath.Rel(cleanDir, dest)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", newInputError("download would write outside localDir")
	}
	return dest, nil
}

func requireAbsoluteLocal(localPath string) (string, error) {
	value := strings.TrimSpace(localPath)
	if value == "" {
		return "", newInputError("localPath is required")
	}
	if strings.ContainsRune(value, 0) {
		return "", newInputError("invalid local path")
	}
	if !filepath.IsAbs(value) {
		return "", newInputError("localPath must be an absolute path")
	}
	return filepath.Clean(value), nil
}
