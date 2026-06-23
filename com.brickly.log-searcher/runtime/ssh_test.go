package main

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

func TestShellQuote(t *testing.T) {
	got := shellQuote("can't match")
	want := `'can'\''t match'`
	if got != want {
		t.Fatalf("shellQuote() = %q, want %q", got, want)
	}
}

func TestShellQuoteGlobPreservesWildcardExpansion(t *testing.T) {
	got := shellQuoteGlob(`/var/log/nginx/access-*.log`)
	want := `'/var/log/nginx/access-'*'.log'`
	if got != want {
		t.Fatalf("shellQuoteGlob() = %q, want %q", got, want)
	}
}

func TestBuildRemoteGrepCommandQuotesPatternAndFiles(t *testing.T) {
	got := buildRemoteGrepCommand(
		[]string{"-H", "-n", "-E"},
		[]FilterConfig{{Pattern: `error|can't`}},
		[]string{"/var/log/app current.log", "/tmp/quote's.log"},
		GrepArgs{},
	)
	want := `grep -H -n -E -- 'error|can'\''t' '/var/log/app current.log' '/tmp/quote'\''s.log'`
	if got != want {
		t.Fatalf("buildRemoteGrepCommand() = %q, want %q", got, want)
	}
}

func TestBuildRemoteGrepCommandAppendsFilterPipeline(t *testing.T) {
	got := buildRemoteGrepCommand(
		[]string{"-H", "-n"},
		[]FilterConfig{
			{Pattern: "error"},
			{Pattern: "user 42", IgnoreCase: true},
			{Pattern: `debug|trace`, Regexp: true, Invert: true},
		},
		[]string{"/var/log/app.log"},
		GrepArgs{},
	)
	want := `grep -H -n -- 'error' '/var/log/app.log' | grep -i -- 'user 42' | grep -v -E -- 'debug|trace'`
	if got != want {
		t.Fatalf("buildRemoteGrepCommand() = %q, want %q", got, want)
	}
}

func TestBuildRemoteGrepCommandUsesTailWindowPerFile(t *testing.T) {
	got := buildRemoteGrepCommand(
		[]string{"-H"},
		[]FilterConfig{{Pattern: "error"}},
		[]string{"/var/log/app.log", "/tmp/quote's.log"},
		GrepArgs{FromTail: true, TailLines: 500, ShowFilename: true},
	)
	mustContainAll(t, got, []string{
		`tail -n 500 -- '/var/log/app.log'`,
		`grep '--label=/var/log/app.log' -H -- 'error'`,
		`tail -n 500 -- '/tmp/quote'\''s.log'`,
		`grep '--label=/tmp/quote'\''s.log' -H -- 'error'`,
	})
}

func TestBuildRemoteGrepCommandTailWindowDoesNotRewriteLineNumbers(t *testing.T) {
	got := buildRemoteGrepCommand(
		[]string{"-H"},
		[]FilterConfig{{Pattern: "error"}},
		[]string{"/var/log/app.log"},
		GrepArgs{FromTail: true, TailLines: 50},
	)
	mustContainAll(t, got, []string{
		`tail -n 50 -- '/var/log/app.log'`,
		`grep '--label=/var/log/app.log' -H -- 'error'`,
	})
	if strings.Contains(got, `awk -v start="$start"`) {
		t.Fatalf("tail command should not rewrite line numbers, got %q", got)
	}
}

func TestBuildRemoteGrepCommandDoesNotUseGrepMaxCount(t *testing.T) {
	got := buildRemoteGrepCommand(
		[]string{"-H", "-n"},
		[]FilterConfig{{Pattern: "error"}},
		[]string{"/var/log/app.log"},
		GrepArgs{MaxCount: 2},
	)
	if strings.Contains(got, " -m ") {
		t.Fatalf("remote grep command should not use grep -m for latest maxCount, got %q", got)
	}
}

func TestBuildRemotePrimaryOptionsDoesNotMapMaxCountToGrepOption(t *testing.T) {
	got := strings.Join(buildRemotePrimaryOptions(GrepArgs{
		ShowFilename: true,
		ShowLineNum:  true,
		MaxCount:     2,
	}), " ")
	if strings.Contains(got, "-m") {
		t.Fatalf("primary opts should not include grep -m for latest maxCount, got %q", got)
	}
}

func TestBuildRemoteGrepCommandTailWindowDoesNotUseGrepMaxCount(t *testing.T) {
	got := buildRemoteGrepCommand(
		[]string{"-H", "-n"},
		[]FilterConfig{{Pattern: "error"}},
		[]string{"/var/log/app.log"},
		GrepArgs{FromTail: true, TailLines: 50, MaxCount: 2},
	)
	if strings.Contains(got, " -m ") {
		t.Fatalf("remote tail grep command should not use grep -m for latest maxCount, got %q", got)
	}
}

func mustContainAll(t *testing.T, value string, parts []string) {
	t.Helper()
	for _, part := range parts {
		if !strings.Contains(value, part) {
			t.Fatalf("expected %q to contain %q", value, part)
		}
	}
}

func TestRemoteGrepOutputParserStripsKnownFilenameAndLineNumberPrefix(t *testing.T) {
	parser := newRemoteGrepOutputParser(
		GrepArgs{ShowFilename: true, ShowLineNum: true},
		[]string{"/var/log/error-app.log"},
	)

	got := parser.content("/var/log/error-app.log:42:ok error")
	want := "ok error"
	if got != want {
		t.Fatalf("content() = %q, want %q", got, want)
	}
}

func TestRemoteLatestMatchCollectorKeepsLatestMatchesInOriginalOrder(t *testing.T) {
	filters, err := compileFilters("error", GrepArgs{})
	if err != nil {
		t.Fatalf("compileFilters() error = %v", err)
	}

	var got []GrepLine
	collector := newRemoteLatestMatchCollector(
		GrepArgs{MaxCount: 2},
		[]string{"/var/log/app.log"},
		filters,
		newSearchHighlighter(filters),
		func(line GrepLine) {
			got = append(got, line)
		},
	)

	collector.add(remoteGrepLine{Raw: "/var/log/app.log:1:error old", FilePath: "/var/log/app.log", LineNum: 1, Content: "error old"})
	collector.add(remoteGrepLine{Raw: "/var/log/app.log:2:error newer", FilePath: "/var/log/app.log", LineNum: 2, Content: "error newer"})
	collector.add(remoteGrepLine{Raw: "/var/log/app.log:3:error latest", FilePath: "/var/log/app.log", LineNum: 3, Content: "error latest"})
	if err := collector.flush(t.Context()); err != nil {
		t.Fatalf("flush() error = %v", err)
	}

	if len(got) != 2 {
		t.Fatalf("got %d lines, want 2: %v", len(got), got)
	}
	if got[0].Text != "error newer" || got[1].Text != "error latest" {
		t.Fatalf("got %v, want latest remote matches in original order", got)
	}
}

func TestReadRemoteGrepOutputUsesCurrentTargetFileWhenOutputHasNoFilename(t *testing.T) {
	filters, err := compileFilters("error", GrepArgs{})
	if err != nil {
		t.Fatalf("compileFilters() error = %v", err)
	}

	var got []GrepLine
	err = readRemoteGrepOutput(
		context.Background(),
		strings.NewReader("error latest\n"),
		"/var/log/app.log",
		GrepArgs{},
		newRemoteGrepOutputParser(GrepArgs{}, []string{"/var/log/app.log"}),
		filters,
		newSearchHighlighter(filters),
		func(line GrepLine) {
			got = append(got, line)
		},
	)
	if err != nil {
		t.Fatalf("readRemoteGrepOutput() error = %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d lines, want 1: %v", len(got), got)
	}
	if got[0].File != "/var/log/app.log" {
		t.Fatalf("got file %q, want current target file", got[0].File)
	}
}

func TestRemoteFileErrorChunkCarriesTargetFile(t *testing.T) {
	err := fmt.Errorf("remote grep failed for /var/log/app.log: permission denied")
	line := GrepLine{
		Text:  err.Error(),
		File:  "/var/log/app.log",
		Error: err.Error(),
	}

	if line.File != "/var/log/app.log" {
		t.Fatalf("got file %q, want current target file", line.File)
	}
	if line.Error == "" {
		t.Fatalf("expected file-level error message")
	}
}

func TestRemoteLatestMatchCollectorPreservesContextAroundLatestMatch(t *testing.T) {
	filters, err := compileFilters("error", GrepArgs{})
	if err != nil {
		t.Fatalf("compileFilters() error = %v", err)
	}

	var got []GrepLine
	collector := newRemoteLatestMatchCollector(
		GrepArgs{MaxCount: 1, ContextC: 1},
		[]string{"/var/log/app.log"},
		filters,
		newSearchHighlighter(filters),
		func(line GrepLine) {
			got = append(got, line)
		},
	)

	collector.add(remoteGrepLine{FilePath: "/var/log/app.log", LineNum: 1, Content: "before old", IsContext: true})
	collector.add(remoteGrepLine{FilePath: "/var/log/app.log", LineNum: 2, Content: "error old"})
	collector.add(remoteGrepLine{FilePath: "/var/log/app.log", LineNum: 3, Content: "after old", IsContext: true})
	collector.add(remoteGrepLine{FilePath: "/var/log/app.log", LineNum: 4, Content: "before latest", IsContext: true})
	collector.add(remoteGrepLine{FilePath: "/var/log/app.log", LineNum: 5, Content: "error latest"})
	collector.add(remoteGrepLine{FilePath: "/var/log/app.log", LineNum: 6, Content: "after latest", IsContext: true})
	if err := collector.flush(t.Context()); err != nil {
		t.Fatalf("flush() error = %v", err)
	}

	if len(got) != 3 {
		t.Fatalf("got %d lines, want latest match with context: %v", len(got), got)
	}
	if got[0].Text != "before latest" || got[1].Text != "error latest" || got[2].Text != "after latest" {
		t.Fatalf("got %v, want latest remote match context", got)
	}
	if !got[0].IsContext || got[1].IsContext || !got[2].IsContext {
		t.Fatalf("unexpected context flags: %+v", got)
	}
}

func TestRemoteLatestMatchCollectorDetectsMatchFromContentWhenPrefixParsingIsDisabled(t *testing.T) {
	filters, err := compileFilters("error", GrepArgs{})
	if err != nil {
		t.Fatalf("compileFilters() error = %v", err)
	}

	var got []GrepLine
	collector := newRemoteLatestMatchCollector(
		GrepArgs{MaxCount: 1, ContextC: 1},
		[]string{"/var/log/app.log"},
		filters,
		newSearchHighlighter(filters),
		func(line GrepLine) {
			got = append(got, line)
		},
	)

	collector.add(remoteGrepLine{FilePath: "/var/log/app.log", LineNum: 1, Content: "before latest", IsContext: true})
	collector.add(remoteGrepLine{FilePath: "/var/log/app.log", LineNum: 2, Content: "error latest", IsContext: true})
	collector.add(remoteGrepLine{FilePath: "/var/log/app.log", LineNum: 3, Content: "after latest", IsContext: true})
	if err := collector.flush(t.Context()); err != nil {
		t.Fatalf("flush() error = %v", err)
	}

	if len(got) != 3 {
		t.Fatalf("got %d lines, want latest match with context: %v", len(got), got)
	}
	if got[1].Text != "error latest" || got[1].IsContext {
		t.Fatalf("got %+v, want middle line detected as match", got)
	}
}

func TestRemoteGrepOutputParserHandlesContextLinePrefix(t *testing.T) {
	parser := newRemoteGrepOutputParser(
		GrepArgs{ShowFilename: true, ShowLineNum: true},
		[]string{"/var/log/error-app.log"},
	)

	got := parser.content("/var/log/error-app.log-42-ok error")
	want := "ok error"
	if got != want {
		t.Fatalf("content() = %q, want %q", got, want)
	}
}

func TestRemoteGrepOutputParserPrefersLongestFilename(t *testing.T) {
	parser := newRemoteGrepOutputParser(
		GrepArgs{ShowFilename: true, ShowLineNum: true},
		[]string{"/var/log/app.log", "/var/log/app.log.1"},
	)

	got := parser.content("/var/log/app.log.1:7:ok error")
	want := "ok error"
	if got != want {
		t.Fatalf("content() = %q, want %q", got, want)
	}
}

func TestRemoteGrepOutputParserKeepsUnknownPrefixUnchanged(t *testing.T) {
	parser := newRemoteGrepOutputParser(
		GrepArgs{ShowFilename: true, ShowLineNum: true},
		[]string{"/var/log/app.log"},
	)

	got := parser.content("/tmp/other.log:7:ok error")
	want := "/tmp/other.log:7:ok error"
	if got != want {
		t.Fatalf("content() = %q, want %q", got, want)
	}
}

func TestBuildRemoteExpandCommandQuotesDirectoryPath(t *testing.T) {
	got := buildRemoteExpandScript(`/var/log/app current`)

	if !strings.Contains(got, `path='/var/log/app current'`) {
		t.Fatalf("expand command should quote path assignment, got %q", got)
	}
	if !strings.Contains(got, `for f in '/var/log/app current'`) {
		t.Fatalf("expand command should quote normal path loop, got %q", got)
	}
}

func TestBuildRemoteExpandCommandKeepsGlobOperatorsOutsideQuotes(t *testing.T) {
	got := buildRemoteExpandScript(`/var/log/app current/*.log`)

	if !strings.Contains(got, `path='/var/log/app current/*.log'`) {
		t.Fatalf("expand command should keep quoted path assignment for directory check, got %q", got)
	}
	if !strings.Contains(got, `for f in '/var/log/app current/'*'.log'`) {
		t.Fatalf("expand command should preserve glob expansion safely, got %q", got)
	}
}

func TestBuildRemoteExpandCommandWrapsScriptWithShell(t *testing.T) {
	got := buildRemoteExpandCommand(`/tmp/app.log`)
	if !strings.HasPrefix(got, "sh -c ") {
		t.Fatalf("buildRemoteExpandCommand() should wrap script with sh -c, got %q", got)
	}
	if !strings.Contains(got, `path='\''/tmp/app.log'\''`) {
		t.Fatalf("buildRemoteExpandCommand() should quote nested script, got %q", got)
	}
}
