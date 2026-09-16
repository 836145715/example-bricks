package main

import "testing"

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

func TestUTF16RangeMapperConvertsByteRangesToBrowserOffsets(t *testing.T) {
	mapper := utf16RangeMapper{}
	content := "🙂 前缀 错误"
	byteRanges := [][]int{{len("🙂 前缀 "), len("🙂 前缀 错误")}}

	got := mapper.fromByteRanges(content, byteRanges, 0)
	assertMatches(t, got, [][]int{{6, 8}})
}

func TestSearchHighlighterUsesUTF16OffsetsForAllPositiveFilters(t *testing.T) {
	filters, err := compileFilters("error", GrepArgs{
		IgnoreCase: true,
		Filters: []FilterConfig{
			{Pattern: "用户=张三"},
			{Pattern: "debug", Invert: true},
		},
	})
	if err != nil {
		t.Fatalf("compileFilters() error = %v", err)
	}

	highlighter := newSearchHighlighter(filters)
	got := highlighter.matches("🙂 error 用户=张三", 4)

	assertMatches(t, got, [][]int{{7, 12}, {13, 18}})
}

func TestContentOffsetUsesDisplayPrefix(t *testing.T) {
	highlighter := newSearchHighlighter(nil)
	if got := highlighter.contentOffset("error line", "error line"); got != 0 {
		t.Fatalf("identical display/content offset = %d, want 0", got)
	}
	if got := highlighter.contentOffset("12:error line", "error line"); got != 3 {
		t.Fatalf("numeric prefix offset = %d, want 3", got)
	}
}

func TestSearchHighlighterLiteralMatchUsesUTF16Length(t *testing.T) {
	highlighter := newSearchHighlighter(nil)
	got := highlighter.literalMatch("🙂错误", 3)

	assertMatches(t, got, [][]int{{3, 7}})
}
