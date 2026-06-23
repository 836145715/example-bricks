package main

import "testing"

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

func TestSearchHighlighterLiteralMatchUsesUTF16Length(t *testing.T) {
	highlighter := newSearchHighlighter(nil)
	got := highlighter.literalMatch("🙂错误", 3)

	assertMatches(t, got, [][]int{{3, 7}})
}
