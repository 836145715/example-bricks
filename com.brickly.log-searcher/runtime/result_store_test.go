package main

import "testing"

func TestResultStorePeekRangeAndServerIsolation(t *testing.T) {
	store := newResultStore()
	runA := store.StartRun("srv-a", []string{"/tmp/a.log"})
	runB := store.StartRun("srv-b", []string{"/tmp/b.log"})

	store.AppendLine("srv-a", runA, "/tmp/a.log", GrepLine{Text: "a-0", File: "/tmp/a.log"})
	store.AppendLine("srv-a", runA, "/tmp/a.log", GrepLine{Text: "a-1", File: "/tmp/a.log"})
	store.AppendLine("srv-b", runB, "/tmp/b.log", GrepLine{Text: "b-0", File: "/tmp/b.log"})

	got := store.Peek("srv-a", runA, "/tmp/a.log", 1, 10)
	if got.Total != 2 || len(got.Lines) != 1 || got.Lines[0].Text != "a-1" {
		t.Fatalf("unexpected peek result: %+v", got)
	}

	other := store.Peek("srv-b", runB, "/tmp/b.log", 0, 10)
	if other.Total != 1 || other.Lines[0].Text != "b-0" {
		t.Fatalf("unexpected isolated result: %+v", other)
	}
}

func TestResultStorePeekOutOfRangeReturnsEmptyLines(t *testing.T) {
	store := newResultStore()
	runID := store.StartRun("srv", []string{"app.log"})
	store.AppendLine("srv", runID, "app.log", GrepLine{Text: "one", File: "app.log"})

	got := store.Peek("srv", runID, "app.log", 10, 100)
	if got.Total != 1 || len(got.Lines) != 0 {
		t.Fatalf("unexpected out-of-range peek: %+v", got)
	}
}

func TestResultStoreClearServerDoesNotAffectOtherServer(t *testing.T) {
	store := newResultStore()
	runA := store.StartRun("srv-a", []string{"a.log"})
	runB := store.StartRun("srv-b", []string{"b.log"})
	store.AppendLine("srv-a", runA, "a.log", GrepLine{Text: "a"})
	store.AppendLine("srv-b", runB, "b.log", GrepLine{Text: "b"})

	store.ClearServer("srv-a")

	gotA := store.Peek("srv-a", runA, "a.log", 0, 10)
	if len(gotA.Lines) != 0 || gotA.Total != 0 {
		t.Fatalf("cleared server should not return lines: %+v", gotA)
	}
	gotB := store.Peek("srv-b", runB, "b.log", 0, 10)
	if len(gotB.Lines) != 1 || gotB.Lines[0].Text != "b" {
		t.Fatalf("other server should keep lines: %+v", gotB)
	}
}

func TestResultStoreIgnoresOldRunWrites(t *testing.T) {
	store := newResultStore()
	oldRun := store.StartRun("srv", []string{"app.log"})
	newRun := store.StartRun("srv", []string{"app.log"})

	if _, ok := store.AppendLine("srv", oldRun, "app.log", GrepLine{Text: "old"}); ok {
		t.Fatalf("old run should not accept writes")
	}
	store.AppendLine("srv", newRun, "app.log", GrepLine{Text: "new"})

	got := store.Peek("srv", newRun, "app.log", 0, 10)
	if len(got.Lines) != 1 || got.Lines[0].Text != "new" {
		t.Fatalf("unexpected new run result: %+v", got)
	}
}

func TestResultStoreAppliesHardLimitAndKeepsLatestLines(t *testing.T) {
	store := newResultStore()
	runID := store.StartRun("srv", []string{"app.log"})

	for i := 0; i < maxStoredLinesPerFile+3; i++ {
		store.AppendLine("srv", runID, "app.log", GrepLine{Text: string(rune('a' + i%26))})
	}

	got := store.Peek("srv", runID, "app.log", 0, 10)
	if !got.Truncated {
		t.Fatalf("expected truncated result")
	}
	if got.Total != maxStoredLinesPerFile {
		t.Fatalf("total should expose retained rows, got %d", got.Total)
	}
	if len(got.Lines) == 0 || got.Lines[0].Index != 0 {
		t.Fatalf("expected first visible index 0, got %+v", got.Lines)
	}
}

func TestResultStoreStoresFileLevelError(t *testing.T) {
	store := newResultStore()
	runID := store.StartRun("srv", []string{"app.log"})
	store.AppendLine("srv", runID, "app.log", GrepLine{Text: "permission denied", File: "app.log", Error: "permission denied"})

	got := store.Peek("srv", runID, "app.log", 0, 10)
	if got.Status != searchStatusError || got.Message != "permission denied" {
		t.Fatalf("unexpected error state: %+v", got)
	}
	if len(got.Lines) != 1 || got.Lines[0].Error == "" {
		t.Fatalf("expected error line: %+v", got.Lines)
	}
}

func TestResultStoreFindNextPrevAndWrap(t *testing.T) {
	store := newResultStore()
	runID := store.StartRun("srv", []string{"app.log"})
	store.AppendLine("srv", runID, "app.log", GrepLine{Text: "alpha error"})
	store.AppendLine("srv", runID, "app.log", GrepLine{Text: "beta Error error"})

	first := store.Find("srv", runID, "app.log", "error", "next", -1, -1, true)
	if first.Total != 3 || first.Ordinal != 1 || first.LineIndex != 0 || first.Start != 6 {
		t.Fatalf("unexpected first find: %+v", first)
	}

	second := store.Find("srv", runID, "app.log", "error", "next", first.LineIndex, first.Start, true)
	if second.Ordinal != 2 || second.LineIndex != 1 || second.Start != 5 {
		t.Fatalf("unexpected second find: %+v", second)
	}

	wrappedPrev := store.Find("srv", runID, "app.log", "error", "prev", 0, 0, true)
	if wrappedPrev.Ordinal != 3 || wrappedPrev.LineIndex != 1 || wrappedPrev.Start != 11 {
		t.Fatalf("unexpected wrapped prev: %+v", wrappedPrev)
	}
}

func TestResultStoreFindUsesUTF16Offsets(t *testing.T) {
	store := newResultStore()
	runID := store.StartRun("srv", []string{"app.log"})
	store.AppendLine("srv", runID, "app.log", GrepLine{Text: "错误🙂error"})

	got := store.Find("srv", runID, "app.log", "error", "next", -1, -1, true)
	if got.Total != 1 || got.Start != 4 || got.End != 9 {
		t.Fatalf("expected UTF-16 offsets after Chinese and emoji, got %+v", got)
	}
}
