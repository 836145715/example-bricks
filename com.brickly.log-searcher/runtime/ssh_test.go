package main

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"sync"
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

func TestBuildRemoteFileInfoCommandQuotesPaths(t *testing.T) {
	got := buildRemoteFileInfoCommand([]string{"/var/log/app current.log", "/tmp/quote's.log"})
	mustContainAll(t, got, []string{
		"sh -c ",
		"/var/log/app current.log",
		"/tmp/quote",
		`stat -c '\''%s %Y'\'' -- "$path"`,
		`stat -f '\''%z %m'\'' -- "$path"`,
		`printf '\''%s\t%s\t%s\t%s\n'\'' "$size" "$modified_at" "" "$path"`,
	})
	if strings.Contains(got, "wc -c") {
		t.Fatalf("file info command should not read whole files with wc -c, got %q", got)
	}
	if strings.Contains(got, "file -b") {
		t.Fatalf("file info command should not probe MIME with file, got %q", got)
	}
	if strings.Contains(got, "/tmp/quote's.log") {
		t.Fatalf("file path with quote should be shell-quoted, got %q", got)
	}
}

func TestGuessRemoteLogMimeType(t *testing.T) {
	cases := []struct {
		path string
		want string
	}{
		{path: "/var/log/app.log", want: "text/plain"},
		{path: "/var/log/app.log.1", want: "text/plain"},
		{path: "/var/log/catalina.out", want: "text/plain"},
		{path: "/var/log/app.log.gz", want: "application/octet-stream"},
		{path: "/srv/service.jar", want: "application/octet-stream"},
		{path: "/srv/image.png", want: "application/octet-stream"},
		{path: "/var/log/events.json", want: "application/json"},
		{path: "/opt/app/unknown", want: ""},
	}
	for _, testCase := range cases {
		got := guessRemoteLogMimeType(testCase.path)
		if got != testCase.want {
			t.Fatalf("guessRemoteLogMimeType(%q) = %q, want %q", testCase.path, got, testCase.want)
		}
	}
}

func TestParseRemoteLogFileInfoLine(t *testing.T) {
	got, ok := parseRemoteLogFileInfoLine("1048576\t/var/log/app current.log")
	if !ok {
		t.Fatal("parseRemoteLogFileInfoLine() should parse a valid result line")
	}
	want := RemoteLogFile{Path: "/var/log/app current.log", SizeBytes: 1048576}
	if got != want {
		t.Fatalf("parseRemoteLogFileInfoLine() = %+v, want %+v", got, want)
	}
}

func TestParseRemoteLogFileInfoLineIncludesModifiedTimeAndMimeType(t *testing.T) {
	got, ok := parseRemoteLogFileInfoLine("1048576\t1722230000\ttext/plain\t/var/log/app current.log")
	if !ok {
		t.Fatal("parseRemoteLogFileInfoLine() should parse a full metadata result line")
	}
	want := RemoteLogFile{
		Path:       "/var/log/app current.log",
		SizeBytes:  1048576,
		ModifiedAt: 1722230000,
		MimeType:   "text/plain",
	}
	if got != want {
		t.Fatalf("parseRemoteLogFileInfoLine() = %+v, want %+v", got, want)
	}
}

func TestFilterSearchableRemoteLogFilesExcludesBinaryFiles(t *testing.T) {
	got := filterSearchableRemoteLogFiles([]RemoteLogFile{
		{Path: "/var/log/app.log", MimeType: "text/plain"},
		{Path: "/srv/service.jar", MimeType: "application/zip"},
		{Path: "/srv/image.png", MimeType: "image/png"},
		{Path: "/var/log/empty.log", MimeType: "inode/x-empty"},
	})
	want := []string{"/var/log/app.log", "/var/log/empty.log"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("filterSearchableRemoteLogFiles() = %v, want %v", got, want)
	}
	if !isSearchableRemoteLogMimeType("") {
		t.Fatal("unknown MIME type should remain visible when the remote host lacks file")
	}
}

func TestBuildRemoteGrepCommandQuotesPatternAndFiles(t *testing.T) {
	got := buildRemoteGrepCommand(
		[]string{"-H", "-n", "-E"},
		[]FilterConfig{{Pattern: `error|can't`}},
		[]string{"/var/log/app current.log", "/tmp/quote's.log"},
		GrepArgs{},
	)
	want := `grep -H -n -E -- 'error|can'\''t' '/var/log/app current.log' '/tmp/quote'\''s.log' | head -n 50000`
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
	want := `grep -H -n -- 'error' '/var/log/app.log' | grep -i -- 'user 42' | grep -v -E -- 'debug|trace' | head -n 50000`
	if got != want {
		t.Fatalf("buildRemoteGrepCommand() = %q, want %q", got, want)
	}
}

func TestBuildRemoteGrepCommandUsesTailBytesPerFile(t *testing.T) {
	got := buildRemoteGrepCommand(
		[]string{"-h", "-n"},
		[]FilterConfig{{Pattern: "error"}},
		[]string{"/var/log/app.log", "/tmp/quote's.log"},
		GrepArgs{TailBytes: 20 * 1024 * 1024},
	)
	mustContainAll(t, got, []string{
		`tail -c 20971520 -- '/var/log/app.log'`,
		`grep '--label=/var/log/app.log' -h -n -- 'error'`,
		`tail -c 20971520 -- '/tmp/quote'\''s.log'`,
		`head -n 50000`,
	})
	if strings.Contains(got, "tail -n ") {
		t.Fatalf("byte window should not use tail -n, got %q", got)
	}
}

func TestIsConcreteRemoteFilePath(t *testing.T) {
	if !isConcreteRemoteFilePath("/var/log/app.log") {
		t.Fatal("plain file should skip expand")
	}
	if isConcreteRemoteFilePath("/var/log/*.log") {
		t.Fatal("glob should expand")
	}
	if isConcreteRemoteFilePath("/var/log/") {
		t.Fatal("directory should expand")
	}
	if isConcreteRemoteFilePath("") {
		t.Fatal("empty path should not be concrete")
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
		newSearchHighlighter(filters),
		func(line GrepLine) bool {
			got = append(got, line)
			return false
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

func TestReadRemoteGrepOutputHidesLineNumbersWhenDisabled(t *testing.T) {
	filters, err := compileFilters("error", GrepArgs{})
	if err != nil {
		t.Fatalf("compileFilters() error = %v", err)
	}

	var got []GrepLine
	err = readRemoteGrepOutput(
		context.Background(),
		strings.NewReader("/var/log/app.log:12:error latest\n"),
		"/var/log/app.log",
		GrepArgs{ShowLineNum: false, ShowFilename: false},
		newRemoteGrepOutputParser(
			GrepArgs{ShowFilename: true, ShowLineNum: true},
			[]string{"/var/log/app.log"},
		),
		newSearchHighlighter(filters),
		func(line GrepLine) bool {
			got = append(got, line)
			return false
		},
	)
	if err != nil {
		t.Fatalf("readRemoteGrepOutput() error = %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d lines, want 1: %v", len(got), got)
	}
	if got[0].Text != "error latest" {
		t.Fatalf("got text %q, want content without line number", got[0].Text)
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

func TestRemoteGrepOutputParserStripsLabelPrefixEvenWhenFilenameHidden(t *testing.T) {
	parser := newRemoteGrepOutputParser(
		GrepArgs{ShowFilename: false, ShowLineNum: true},
		[]string{"/var/log/app.log"},
	)

	got := parser.parse("/var/log/app.log:12:error latest")
	if got.Content != "error latest" {
		t.Fatalf("content = %q, want log body without file/line prefix", got.Content)
	}
	if got.FilePath != "/var/log/app.log" || got.LineNum != 12 {
		t.Fatalf("unexpected parsed meta: %+v", got)
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

func TestExpandRemotePathsWithExpandsPathsConcurrentlyAndPreservesOrder(t *testing.T) {
	paths := make([]string, maxConcurrentFileSearches*2)
	for index := range paths {
		paths[index] = fmt.Sprintf("file-%d.log", index)
	}
	started := make(chan struct{}, maxConcurrentFileSearches)
	release := make(chan struct{})
	var mu sync.Mutex
	active := 0
	peak := 0

	type expansionResult struct {
		files []string
		err   error
	}
	done := make(chan expansionResult, 1)
	go func() {
		files, err := expandRemotePathsWith(context.Background(), paths, func(_ context.Context, path string) ([]string, error) {
			mu.Lock()
			active++
			if active > peak {
				peak = active
			}
			mu.Unlock()

			started <- struct{}{}
			<-release

			mu.Lock()
			active--
			mu.Unlock()
			return []string{path + ".expanded"}, nil
		})
		done <- expansionResult{files: files, err: err}
	}()

	for index := 0; index < maxConcurrentFileSearches; index++ {
		<-started
	}
	close(release)

	result := <-done
	if result.err != nil {
		t.Fatalf("expandRemotePathsWith() error = %v", result.err)
	}
	if peak != maxConcurrentFileSearches {
		t.Fatalf("peak concurrent expansions = %d, want %d", peak, maxConcurrentFileSearches)
	}
	want := make([]string, len(paths))
	for index, path := range paths {
		want[index] = path + ".expanded"
	}
	if len(result.files) != len(want) {
		t.Fatalf("expanded files = %v, want %v", result.files, want)
	}
	for index := range want {
		if result.files[index] != want[index] {
			t.Fatalf("expanded files = %v, want %v", result.files, want)
		}
	}
}

func TestCapRemoteGrepOutputAddsHeadWhenUnlimited(t *testing.T) {
	got := capRemoteGrepOutput("grep -- 'error' '/var/log/app.log'")
	want := "grep -- 'error' '/var/log/app.log' | head -n 50000"
	if got != want {
		t.Fatalf("capRemoteGrepOutput() = %q, want %q", got, want)
	}
}

func TestReadRemoteGrepOutputStopsAtLineLimit(t *testing.T) {
	filters, err := compileFilters("error", GrepArgs{})
	if err != nil {
		t.Fatalf("compileFilters() error = %v", err)
	}

	var builder strings.Builder
	for i := 0; i < maxStoredLinesPerFile+8; i++ {
		builder.WriteString("error line\n")
	}

	count := 0
	err = readRemoteGrepOutput(
		context.Background(),
		strings.NewReader(builder.String()),
		"/var/log/app.log",
		GrepArgs{},
		newRemoteGrepOutputParser(GrepArgs{}, []string{"/var/log/app.log"}),
		newSearchHighlighter(filters),
		func(GrepLine) bool {
			count++
			return count >= maxStoredLinesPerFile
		},
	)
	if !errors.Is(err, errSearchLineLimit) {
		t.Fatalf("readRemoteGrepOutput() error = %v, want %v", err, errSearchLineLimit)
	}
	if count != maxStoredLinesPerFile {
		t.Fatalf("emitted %d lines, want %d", count, maxStoredLinesPerFile)
	}
}
