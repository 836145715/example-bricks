package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func writeTestLog(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "app.log")
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("write test log: %v", err)
	}
	return path
}

func writeNamedTestLog(t *testing.T, name string, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("write test log: %v", err)
	}
	return path
}

func collectLocalGrep(t *testing.T, pattern string, file string, args GrepArgs) []string {
	t.Helper()
	var lines []string
	err := RunLocalGrep(context.Background(), pattern, []string{file}, args, func(line GrepLine) {
		lines = append(lines, line.Text)
	})
	if err != nil {
		t.Fatalf("RunLocalGrep() error = %v", err)
	}
	return lines
}

func collectLocalGrepLines(t *testing.T, pattern string, file string, args GrepArgs) []GrepLine {
	t.Helper()
	var lines []GrepLine
	err := RunLocalGrep(context.Background(), pattern, []string{file}, args, func(line GrepLine) {
		lines = append(lines, line)
	})
	if err != nil {
		t.Fatalf("RunLocalGrep() error = %v", err)
	}
	return lines
}

func assertMatches(t *testing.T, got [][]int, want [][]int) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got matches %v, want %v", got, want)
	}
	for i := range want {
		if len(got[i]) != 2 || got[i][0] != want[i][0] || got[i][1] != want[i][1] {
			t.Fatalf("got matches %v, want %v", got, want)
		}
	}
}

func TestRunLocalGrepChainsFiltersWithAndSemantics(t *testing.T) {
	file := writeTestLog(t, "error user=1\nerror user=2\nsuccess user=2\n")

	got := collectLocalGrep(t, "error", file, GrepArgs{
		IgnoreCase: true,
		Filters: []FilterConfig{
			{Pattern: "user=2", IgnoreCase: true},
		},
	})

	if len(got) != 1 || got[0] != "error user=2" {
		t.Fatalf("got %v, want only error user=2", got)
	}
}

func TestRunLocalGrepHighlightsChainedFilters(t *testing.T) {
	file := writeTestLog(t, "error user=2\n")

	got := collectLocalGrepLines(t, "error", file, GrepArgs{
		IgnoreCase: true,
		Filters: []FilterConfig{
			{Pattern: "user=2", IgnoreCase: true},
		},
	})

	if len(got) != 1 {
		t.Fatalf("got %d lines, want 1: %v", len(got), got)
	}
	assertMatches(t, got[0].Matches, [][]int{{0, 5}, {6, 12}})
}

func TestRunLocalGrepHighlightsChinesePatternWithUTF16Offsets(t *testing.T) {
	file := writeTestLog(t, "前缀 错误 后缀\n")

	got := collectLocalGrepLines(t, "错误", file, GrepArgs{})

	if len(got) != 1 {
		t.Fatalf("got %d lines, want 1: %v", len(got), got)
	}
	assertMatches(t, got[0].Matches, [][]int{{3, 5}})
}

func TestRunLocalGrepHighlightsChainedFiltersAfterEmojiWithUTF16Offsets(t *testing.T) {
	file := writeTestLog(t, "🙂 error 用户=张三 成功\n")

	got := collectLocalGrepLines(t, "error", file, GrepArgs{
		IgnoreCase: true,
		Filters: []FilterConfig{
			{Pattern: "用户=张三"},
		},
	})

	if len(got) != 1 {
		t.Fatalf("got %d lines, want 1: %v", len(got), got)
	}
	assertMatches(t, got[0].Matches, [][]int{{3, 8}, {9, 14}})
}

func TestRunLocalGrepDoesNotHighlightFilenamePrefix(t *testing.T) {
	file := writeNamedTestLog(t, "error.log", "ok error\n")

	got := collectLocalGrepLines(t, "error", file, GrepArgs{
		ShowFilename: true,
		ShowLineNum:  true,
	})

	if len(got) != 1 {
		t.Fatalf("got %d lines, want 1: %v", len(got), got)
	}
	if got[0].Text != "error.log:1:ok error" {
		t.Fatalf("got text %q, want error.log:1:ok error", got[0].Text)
	}
	assertMatches(t, got[0].Matches, [][]int{{15, 20}})
}

func TestRunLocalGrepSupportsInvertFilter(t *testing.T) {
	file := writeTestLog(t, "error debug\nerror release\nerror trace\n")

	got := collectLocalGrep(t, "error", file, GrepArgs{
		IgnoreCase: true,
		Filters: []FilterConfig{
			{Pattern: "debug", Invert: true},
			{Pattern: "trace", Invert: true},
		},
	})

	if len(got) != 1 || got[0] != "error release" {
		t.Fatalf("got %v, want only error release", got)
	}
}

func TestRunLocalGrepSupportsRegexpFilter(t *testing.T) {
	file := writeTestLog(t, "error code=400\nerror code=500\nerror code=503\n")

	got := collectLocalGrep(t, "error", file, GrepArgs{
		IgnoreCase: true,
		Filters: []FilterConfig{
			{Pattern: `code=5\d\d`, Regexp: true},
		},
	})

	if len(got) != 2 || got[0] != "error code=500" || got[1] != "error code=503" {
		t.Fatalf("got %v, want 5xx error lines", got)
	}
}

func TestRunLocalGrepHonorsMaxCountAfterChainedFilters(t *testing.T) {
	file := writeTestLog(t, "error user=1\nerror user=2\nerror user=3\n")

	got := collectLocalGrep(t, "error", file, GrepArgs{
		IgnoreCase: true,
		MaxCount:   2,
		Filters: []FilterConfig{
			{Pattern: "user=", IgnoreCase: true},
		},
	})

	if len(got) != 2 {
		t.Fatalf("got %d lines, want max 2: %v", len(got), got)
	}
	if got[0] != "error user=2" || got[1] != "error user=3" {
		t.Fatalf("got %v, want latest matches in log order", got)
	}
}

func TestRunLocalGrepKeepsLatestMaxCountInOriginalOrder(t *testing.T) {
	file := writeTestLog(t, "error old\nok middle\nerror newer\nerror latest\n")

	got := collectLocalGrep(t, "error", file, GrepArgs{
		MaxCount: 2,
	})

	if len(got) != 2 {
		t.Fatalf("got %d lines, want 2: %v", len(got), got)
	}
	if got[0] != "error newer" || got[1] != "error latest" {
		t.Fatalf("got %v, want latest 2 matches in original order", got)
	}
}

func TestRunLocalGrepMaxCountPreservesContextAroundKeptMatches(t *testing.T) {
	file := writeTestLog(t, "before old\nerror old\nafter old\nbefore latest\nerror latest\nafter latest\n")

	got := collectLocalGrepLines(t, "error", file, GrepArgs{
		MaxCount: 1,
		ContextC: 1,
	})

	if len(got) != 3 {
		t.Fatalf("got %d lines, want latest match with context: %v", len(got), got)
	}
	if got[0].Text != "before latest" || got[1].Text != "error latest" || got[2].Text != "after latest" {
		t.Fatalf("got %v, want latest match context", got)
	}
	if !got[0].IsContext || got[1].IsContext || !got[2].IsContext {
		t.Fatalf("unexpected context flags: %+v", got)
	}
}

func TestRunLocalGrepSearchesTailWindow(t *testing.T) {
	file := writeTestLog(t, "error old\nok middle\nerror latest\n")

	got := collectLocalGrepLines(t, "error", file, GrepArgs{
		FromTail:  true,
		TailLines: 2,
	})

	if len(got) != 1 {
		t.Fatalf("got %d lines, want 1: %v", len(got), got)
	}
	if got[0].Text != "error latest" {
		t.Fatalf("got text %q, want error latest", got[0].Text)
	}
}

func TestRunLocalGrepMaxCountAppliesWithinTailWindow(t *testing.T) {
	file := writeTestLog(t, "error outside tail\nerror tail old\nok tail middle\nerror tail latest\n")

	got := collectLocalGrep(t, "error", file, GrepArgs{
		FromTail:  true,
		TailLines: 3,
		MaxCount:  1,
	})

	if len(got) != 1 {
		t.Fatalf("got %d lines, want 1: %v", len(got), got)
	}
	if got[0] != "error tail latest" {
		t.Fatalf("got %v, want latest match inside tail window", got)
	}
}

func TestRunLocalGrepIncludesStructuredSource(t *testing.T) {
	file := writeNamedTestLog(t, "app.log", "ok error\n")

	got := collectLocalGrepLines(t, "error", file, GrepArgs{ShowFilename: true, ShowLineNum: true})

	if len(got) != 1 {
		t.Fatalf("got %d lines, want 1: %v", len(got), got)
	}
	if got[0].File != file {
		t.Fatalf("got file %q, want %q", got[0].File, file)
	}
}

func TestRunLocalGrepOnlyMatchHighlightsReturnedFragment(t *testing.T) {
	file := writeTestLog(t, "prefix error suffix\n")

	got := collectLocalGrepLines(t, "error", file, GrepArgs{
		IgnoreCase:   true,
		OnlyMatch:    true,
		ShowFilename: true,
		ShowLineNum:  true,
	})

	if len(got) != 1 {
		t.Fatalf("got %d lines, want 1: %v", len(got), got)
	}
	if got[0].Text != "app.log:1:error" {
		t.Fatalf("got text %q, want app.log:1:error", got[0].Text)
	}
	assertMatches(t, got[0].Matches, [][]int{{10, 15}})
}

func TestRunLocalGrepOnlyMatchHighlightsReturnedFragmentAfterUTF16Prefix(t *testing.T) {
	file := writeNamedTestLog(t, "日志🙂.log", "prefix 错误 suffix\n")

	got := collectLocalGrepLines(t, "错误", file, GrepArgs{
		OnlyMatch:    true,
		ShowFilename: true,
		ShowLineNum:  true,
	})

	if len(got) != 1 {
		t.Fatalf("got %d lines, want 1: %v", len(got), got)
	}
	if got[0].Text != "日志🙂.log:1:错误" {
		t.Fatalf("got text %q, want 日志🙂.log:1:错误", got[0].Text)
	}
	assertMatches(t, got[0].Matches, [][]int{{11, 13}})
}

func TestParseGrepArgsAcceptsTopLevelFilters(t *testing.T) {
	args := parseGrepArgs(map[string]any{
		"args": map[string]any{
			"ignoreCase": true,
			"filters": []any{
				map[string]any{"pattern": "from-args"},
			},
		},
		"filters": []any{
			map[string]any{
				"pattern":    "from-top-level",
				"invert":     true,
				"ignoreCase": true,
			},
		},
	})

	if !args.IgnoreCase {
		t.Fatalf("ignoreCase should be parsed from args")
	}
	if len(args.Filters) != 1 {
		t.Fatalf("got %d filters, want 1", len(args.Filters))
	}
	if args.Filters[0].Pattern != "from-top-level" || !args.Filters[0].Invert || !args.Filters[0].IgnoreCase {
		t.Fatalf("unexpected top-level filter: %+v", args.Filters[0])
	}
}
