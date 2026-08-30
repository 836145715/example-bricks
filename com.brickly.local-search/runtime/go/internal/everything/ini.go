package everything

import (
	"os"
	"path/filepath"
	"strings"
)

func bundledIniPath() string {
	return filepath.Join(RuntimeDir(), "Everything.ini")
}

func ensureRunAsAdminIni() error {
	path := bundledIniPath()
	existing := ""
	if data, err := os.ReadFile(path); err == nil {
		existing = string(data)
	}
	updated := upsertIni(existing, map[string]string{
		"allow_run_as_admin": "1",
		"run_as_admin":       "1",
		"index_as_admin":     "1",
	})
	if updated == existing {
		return nil
	}
	return os.WriteFile(path, []byte(updated), 0o644)
}

func upsertIni(content string, keys map[string]string) string {
	pending := make(map[string]string, len(keys))
	for key, value := range keys {
		pending[strings.ToLower(key)] = value
	}

	lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	out := make([]string, 0, len(lines)+len(keys))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, ";") {
			out = append(out, line)
			continue
		}
		key, _, ok := strings.Cut(trimmed, "=")
		if !ok {
			out = append(out, line)
			continue
		}
		lower := strings.ToLower(strings.TrimSpace(key))
		if value, exists := pending[lower]; exists {
			out = append(out, strings.TrimSpace(key)+"="+value)
			delete(pending, lower)
			continue
		}
		out = append(out, line)
	}
	for _, key := range []string{"allow_run_as_admin", "run_as_admin", "index_as_admin"} {
		if value, exists := pending[key]; exists {
			out = append(out, key+"="+value)
		}
	}
	text := strings.Join(out, "\n")
	if !strings.HasSuffix(text, "\n") {
		text += "\n"
	}
	return text
}
