package main

import (
	"encoding/json"
	"strings"
	"unicode/utf8"
)

const (
	authPassword = "password"
	authKey      = "key"
	maxNameRunes = 80
	maxNoteRunes = 500
	maxTagCount  = 16
	maxTagRunes  = 32
)

// Host 是独立于日志工具的 SSH 主机配置。密钥只存本机配置文件。
type Host struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Group      string   `json:"group"`
	Tags       []string `json:"tags"`
	Host       string   `json:"host"`
	Port       int      `json:"port"`
	User       string   `json:"user"`
	AuthType   string   `json:"authType"`
	Password   string   `json:"password,omitempty"`
	KeyPath    string   `json:"keyPath,omitempty"`
	KeyText    string   `json:"keyText,omitempty"`
	Passphrase string   `json:"passphrase,omitempty"`
	Note       string   `json:"note,omitempty"`
}

type hostStore struct {
	Hosts []Host `json:"hosts"`
}

func normalizeHost(host Host) Host {
	host.ID = strings.TrimSpace(host.ID)
	host.Name = strings.TrimSpace(host.Name)
	host.Group = strings.TrimSpace(host.Group)
	host.Host = strings.TrimSpace(host.Host)
	host.User = strings.TrimSpace(host.User)
	host.AuthType = strings.TrimSpace(host.AuthType)
	host.KeyPath = strings.TrimSpace(host.KeyPath)
	host.Note = strings.TrimSpace(host.Note)
	if host.Port <= 0 {
		host.Port = 22
	}
	if host.AuthType == "" {
		host.AuthType = authPassword
	}
	host.Tags = normalizeTags(host.Tags)
	if host.Name == "" {
		host.Name = host.Host
	}
	return host
}

func normalizeTags(tags []string) []string {
	if len(tags) == 0 {
		return []string{}
	}
	seen := make(map[string]struct{}, len(tags))
	out := make([]string, 0, len(tags))
	for _, tag := range tags {
		value := strings.TrimSpace(tag)
		if value == "" {
			continue
		}
		key := strings.ToLower(value)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, value)
		if len(out) >= maxTagCount {
			break
		}
	}
	return out
}

func validateHost(host Host) error {
	if host.Host == "" {
		return newInputError("host is required")
	}
	if host.User == "" {
		return newInputError("user is required")
	}
	if host.Port < 1 || host.Port > 65535 {
		return newInputError("port must be between 1 and 65535")
	}
	if utf8.RuneCountInString(host.Name) > maxNameRunes {
		return newInputError("name is too long")
	}
	if utf8.RuneCountInString(host.Group) > maxNameRunes {
		return newInputError("group is too long")
	}
	if utf8.RuneCountInString(host.Note) > maxNoteRunes {
		return newInputError("note is too long")
	}
	for _, tag := range host.Tags {
		if utf8.RuneCountInString(tag) > maxTagRunes {
			return newInputError("tag is too long")
		}
	}
	switch host.AuthType {
	case authPassword:
		if strings.TrimSpace(host.Password) == "" {
			return newInputError("password is required")
		}
	case authKey:
		if host.KeyText == "" && host.KeyPath == "" {
			return newInputError("private key is required")
		}
	default:
		return newInputError("authType must be password or key")
	}
	return nil
}

func decodeHostDraft(raw any) (Host, error) {
	if raw == nil {
		return Host{}, newInputError("host is required")
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return Host{}, newInputError("invalid host")
	}
	var host Host
	if err := json.Unmarshal(data, &host); err != nil {
		return Host{}, newInputError("invalid host")
	}
	return normalizeHost(host), nil
}

func decodeHost(raw any) (Host, error) {
	host, err := decodeHostDraft(raw)
	if err != nil {
		return Host{}, err
	}
	if err := validateHost(host); err != nil {
		return Host{}, err
	}
	return host, nil
}

func publicHost(host Host) map[string]any {
	tags := host.Tags
	if tags == nil {
		tags = []string{}
	}
	return map[string]any{
		"id":          host.ID,
		"name":        host.Name,
		"group":       host.Group,
		"tags":        tags,
		"host":        host.Host,
		"port":        host.Port,
		"user":        host.User,
		"authType":    host.AuthType,
		"note":        host.Note,
		"hasPassword": strings.TrimSpace(host.Password) != "",
		"hasKey":      host.KeyText != "" || strings.TrimSpace(host.KeyPath) != "",
	}
}

func mergeHostSecrets(existing, incoming Host) Host {
	if incoming.AuthType == authPassword && strings.TrimSpace(incoming.Password) == "" {
		incoming.Password = existing.Password
	}
	if incoming.AuthType == authKey {
		if incoming.KeyText == "" && strings.TrimSpace(incoming.KeyPath) == "" {
			incoming.KeyText = existing.KeyText
			incoming.KeyPath = existing.KeyPath
		}
		if incoming.Passphrase == "" {
			incoming.Passphrase = existing.Passphrase
		}
	}
	return incoming
}

func hostLogFields(host Host) map[string]any {
	return map[string]any{
		"id":       host.ID,
		"name":     host.Name,
		"host":     host.Host,
		"port":     host.Port,
		"user":     host.User,
		"authType": host.AuthType,
		"group":    host.Group,
	}
}

func matchHost(host Host, query string) bool {
	query = strings.ToLower(strings.TrimSpace(query))
	if query == "" {
		return true
	}
	fields := []string{host.Name, host.Group, host.Host, host.User, host.Note}
	fields = append(fields, host.Tags...)
	for _, field := range fields {
		if strings.Contains(strings.ToLower(field), query) {
			return true
		}
	}
	return false
}

func upsertHost(hosts []Host, incoming Host) []Host {
	for i, existing := range hosts {
		if existing.ID == incoming.ID {
			hosts[i] = incoming
			return hosts
		}
	}
	return append(hosts, incoming)
}

func removeHost(hosts []Host, hostID string) ([]Host, bool) {
	out := make([]Host, 0, len(hosts))
	found := false
	for _, host := range hosts {
		if host.ID == hostID {
			found = true
			continue
		}
		out = append(out, host)
	}
	return out, found
}

func findHost(hosts []Host, hostID string) (Host, bool) {
	for _, host := range hosts {
		if host.ID == hostID {
			return host, true
		}
	}
	return Host{}, false
}
