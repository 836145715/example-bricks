package main

import (
	"strings"
	"testing"
)

func TestBrowsePathHasGlob(t *testing.T) {
	if browsePathHasGlob("/var/log/nginx") {
		t.Fatal("plain path should not be treated as glob")
	}
	if !browsePathHasGlob("/var/log/nginx/*.log") {
		t.Fatal("wildcard path should be treated as glob")
	}
}

func TestParentRemotePath(t *testing.T) {
	cases := []struct {
		path string
		want string
	}{
		{path: "/var/log/nginx/*.log", want: "/var/log/nginx"},
		{path: "/var/log", want: "/var"},
		{path: "/var", want: "/"},
		{path: "/", want: ""},
		{path: "", want: ""},
	}
	for _, testCase := range cases {
		got := parentRemotePath(testCase.path)
		if got != testCase.want {
			t.Fatalf("parentRemotePath(%q) = %q, want %q", testCase.path, got, testCase.want)
		}
	}
}

func TestBuildRemoteBrowseCommandQuotesPath(t *testing.T) {
	got := buildRemoteBrowseCommand("/var/log/app current")
	mustContainAll(t, got, []string{
		"sh -c ",
		"/var/log/app current",
		"not-found",
		"not-directory",
		"CWD",
		"ENT",
	})
	if strings.Contains(got, "/var/log/app current") && !strings.Contains(got, `'`) {
		t.Fatalf("path with space should be quoted, got %q", got)
	}
}

func TestParseRemoteBrowseOutput(t *testing.T) {
	result, err := parseRemoteBrowseOutput([]string{
		"CWD\t/var/log/nginx",
		"PARENT\t/var/log",
		"ENT\tdir\t4096\t1710000000\tsites-enabled\t/var/log/nginx/sites-enabled",
		"ENT\tfile\t1048576\t1710000100\taccess.log\t/var/log/nginx/access.log",
		"ENT\tfile\t2048\t1710000200\taccess.log.gz\t/var/log/nginx/access.log.gz",
		"TRUNC\t1",
	})
	if err != nil {
		t.Fatalf("parseRemoteBrowseOutput() error = %v", err)
	}
	if result.Path != "/var/log/nginx" || result.Parent != "/var/log" || !result.Truncated {
		t.Fatalf("unexpected result header: %+v", result)
	}
	if len(result.Entries) != 3 {
		t.Fatalf("entries = %d, want 3", len(result.Entries))
	}
	if result.Entries[0].Kind != browseEntryDir || result.Entries[0].Name != "sites-enabled" {
		t.Fatalf("directories should sort first: %+v", result.Entries[0])
	}
	if !result.Entries[1].Searchable || result.Entries[1].Name != "access.log" {
		t.Fatalf("text log should be searchable: %+v", result.Entries[1])
	}
	if result.Entries[2].Searchable {
		t.Fatalf("gzip log should not be searchable: %+v", result.Entries[2])
	}
}

func TestParseRemoteBrowseOutputMissingPath(t *testing.T) {
	_, err := parseRemoteBrowseOutput([]string{"ENT\tfile\t1\t1\tapp.log\t/tmp/app.log"})
	if err == nil {
		t.Fatal("missing CWD should fail")
	}
}

func TestParseRemoteBrowseOutputNotFound(t *testing.T) {
	_, err := parseRemoteBrowseOutput([]string{"ERR\tnot-found"})
	if err == nil || !strings.Contains(err.Error(), "不存在") {
		t.Fatalf("not-found error = %v", err)
	}
}

func TestEntryFromRemoteLogFile(t *testing.T) {
	entry := entryFromRemoteLogFile(RemoteLogFile{
		Path:       "/var/log/app.log",
		SizeBytes:  12,
		ModifiedAt: 100,
		MimeType:   "text/plain",
	})
	if entry.Name != "app.log" || entry.Kind != browseEntryFile || !entry.Searchable {
		t.Fatalf("unexpected entry: %+v", entry)
	}
}
