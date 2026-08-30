package main

import (
	"strings"
	"testing"
)

func TestValidateHostRequiresCoreFields(t *testing.T) {
	err := validateHost(normalizeHost(Host{
		Name:     "demo",
		Host:     "",
		User:     "root",
		AuthType: authPassword,
		Password: "secret",
	}))
	if err == nil || !strings.Contains(err.Error(), "host is required") {
		t.Fatalf("expected host required, got %v", err)
	}
}

func TestValidateHostPasswordAndKey(t *testing.T) {
	if err := validateHost(normalizeHost(Host{
		Host:     "10.0.0.8",
		User:     "ops",
		AuthType: authPassword,
	})); err == nil {
		t.Fatal("expected password required")
	}
	if err := validateHost(normalizeHost(Host{
		Host:     "10.0.0.8",
		User:     "ops",
		AuthType: authKey,
	})); err == nil {
		t.Fatal("expected private key required")
	}
	if err := validateHost(normalizeHost(Host{
		Host:     "10.0.0.8",
		User:     "ops",
		AuthType: authKey,
		KeyText:  "-----BEGIN OPENSSH PRIVATE KEY-----\nxxx\n",
	})); err != nil {
		t.Fatalf("valid key host rejected: %v", err)
	}
}

func TestMatchHostSearchesNameHostTags(t *testing.T) {
	host := normalizeHost(Host{
		Name:     "支付核心",
		Group:    "生产",
		Host:     "pay.internal",
		User:     "deploy",
		AuthType: authPassword,
		Password: "x",
		Tags:     []string{"prod", "pay"},
	})
	if !matchHost(host, "支付") || !matchHost(host, "INTERNAL") || !matchHost(host, "prod") {
		t.Fatal("expected host to match name, address and tag")
	}
	if matchHost(host, "staging") {
		t.Fatal("unexpected match")
	}
}

func TestUpsertAndRemoveHost(t *testing.T) {
	first := Host{ID: "h1", Name: "a", Host: "a.example", User: "u", AuthType: authPassword, Password: "p", Port: 22}
	hosts := upsertHost(nil, first)
	hosts = upsertHost(hosts, Host{ID: "h1", Name: "b", Host: "b.example", User: "u", AuthType: authPassword, Password: "p", Port: 22})
	if len(hosts) != 1 || hosts[0].Name != "b" {
		t.Fatalf("upsert should replace same id: %#v", hosts)
	}
	next, found := removeHost(hosts, "h1")
	if !found || len(next) != 0 {
		t.Fatalf("remove failed: found=%v hosts=%#v", found, next)
	}
}

func TestPublicHostOmitsSecrets(t *testing.T) {
	view := publicHost(Host{
		ID:         "h1",
		Name:       "core",
		Host:       "10.0.0.1",
		Port:       22,
		User:       "root",
		AuthType:   authPassword,
		Password:   "super-secret",
		KeyText:    "PRIVATE",
		KeyPath:    "C:\\keys\\id",
		Passphrase: "phrase",
		Note:       "prod",
	})
	if view["password"] != nil || view["keyText"] != nil || view["keyPath"] != nil || view["passphrase"] != nil {
		t.Fatalf("secrets leaked: %#v", view)
	}
	if view["hasPassword"] != true || view["hasKey"] != true {
		t.Fatalf("secret flags: %#v", view)
	}
	if view["note"] != "prod" || view["host"] != "10.0.0.1" {
		t.Fatalf("public fields: %#v", view)
	}
}

func TestMergeHostSecretsKeepsStoredOnBlankUpdate(t *testing.T) {
	existing := Host{
		AuthType:   authPassword,
		Password:   "stored",
		KeyText:    "OLDKEY",
		KeyPath:    "/old",
		Passphrase: "old-phrase",
	}
	merged := mergeHostSecrets(existing, Host{AuthType: authPassword, Password: ""})
	if merged.Password != "stored" {
		t.Fatalf("password=%q", merged.Password)
	}

	key := mergeHostSecrets(existing, Host{AuthType: authKey})
	if key.KeyText != "OLDKEY" || key.KeyPath != "/old" || key.Passphrase != "old-phrase" {
		t.Fatalf("key merge: %#v", key)
	}

	replaced := mergeHostSecrets(existing, Host{AuthType: authPassword, Password: "new"})
	if replaced.Password != "new" {
		t.Fatalf("should replace password, got %q", replaced.Password)
	}
}

func TestHostLogFieldsOmitSecrets(t *testing.T) {
	fields := hostLogFields(Host{
		ID:         "h1",
		Name:       "core",
		Host:       "10.0.0.1",
		Port:       22,
		User:       "root",
		AuthType:   authPassword,
		Password:   "super-secret",
		KeyText:    "PRIVATE",
		Passphrase: "phrase",
	})
	encoded := strings.ToLower(strings.Join([]string{
		fields["id"].(string),
		fields["host"].(string),
		fields["user"].(string),
	}, " "))
	if strings.Contains(encoded, "super-secret") || strings.Contains(encoded, "private") {
		t.Fatalf("secrets leaked into log fields: %#v", fields)
	}
	if _, ok := fields["password"]; ok {
		t.Fatal("password must not appear in log fields")
	}
}
