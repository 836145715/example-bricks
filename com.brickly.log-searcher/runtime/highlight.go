package main

import "strings"

// highlightRangeMapper 负责把后端正则命中的字节区间映射成前端可直接使用的坐标。
// 前端 React 渲染使用 String.prototype.slice，因此统一输出 UTF-16 code unit 区间。
type highlightRangeMapper interface {
	length(value string) int
	fromByteRanges(value string, byteRanges [][]int, offset int) [][]int
}

type utf16RangeMapper struct{}

func (utf16RangeMapper) length(value string) int {
	length := 0
	for _, r := range value {
		if r > 0xFFFF {
			length += 2
		} else {
			length++
		}
	}
	return length
}

func (mapper utf16RangeMapper) fromByteRanges(value string, byteRanges [][]int, offset int) [][]int {
	if len(byteRanges) == 0 {
		return [][]int{}
	}

	type clampedRange struct {
		start int
		end   int
	}
	clamped := make([]clampedRange, 0, len(byteRanges))
	needed := make([]int, 0, len(byteRanges)*2)
	for _, byteRange := range byteRanges {
		if len(byteRange) != 2 {
			continue
		}
		startByte := byteRange[0]
		endByte := byteRange[1]
		if startByte < 0 {
			startByte = 0
		}
		if endByte > len(value) {
			endByte = len(value)
		}
		if startByte >= endByte {
			continue
		}
		clamped = append(clamped, clampedRange{start: startByte, end: endByte})
		needed = append(needed, startByte, endByte)
	}
	utf16At := mapper.byteOffsets(value, needed)

	ranges := make([][]int, 0, len(clamped))
	for _, byteRange := range clamped {
		start := offset + utf16At[byteRange.start]
		end := offset + utf16At[byteRange.end]
		if start < end {
			ranges = append(ranges, []int{start, end})
		}
	}
	return ranges
}

func (mapper utf16RangeMapper) byteOffset(value string, byteOffset int) int {
	return mapper.byteOffsets(value, []int{byteOffset})[byteOffset]
}

func (mapper utf16RangeMapper) byteOffsets(value string, offsets []int) map[int]int {
	result := make(map[int]int, len(offsets))
	if len(offsets) == 0 {
		return result
	}

	pending := make(map[int]struct{}, len(offsets))
	for _, offset := range offsets {
		if offset <= 0 {
			result[offset] = 0
			continue
		}
		pending[offset] = struct{}{}
	}
	if len(pending) == 0 {
		return result
	}

	utf16Offset := 0
	for currentByteOffset, r := range value {
		for offset := range pending {
			if currentByteOffset >= offset {
				result[offset] = utf16Offset
				delete(pending, offset)
			}
		}
		if len(pending) == 0 {
			return result
		}
		if r > 0xFFFF {
			utf16Offset += 2
		} else {
			utf16Offset++
		}
	}
	for offset := range pending {
		result[offset] = utf16Offset
	}
	return result
}

// searchHighlighter 是 SSH 检索结果 matches 的统一生成入口。
type searchHighlighter struct {
	filters []compiledFilter
	mapper  highlightRangeMapper
}

func newSearchHighlighter(filters []compiledFilter) searchHighlighter {
	return searchHighlighter{
		filters: filters,
		mapper:  utf16RangeMapper{},
	}
}

func (highlighter searchHighlighter) contentOffset(displayText string, content string) int {
	if content == "" {
		return highlighter.mapper.length(displayText)
	}
	if displayText == content {
		return 0
	}
	if strings.HasSuffix(displayText, content) {
		return highlighter.mapper.length(displayText[:len(displayText)-len(content)])
	}
	return highlighter.mapper.length(displayText) - highlighter.mapper.length(content)
}

func (highlighter searchHighlighter) displayMatches(displayText string, content string) [][]int {
	return highlighter.matches(content, highlighter.contentOffset(displayText, content))
}

func (highlighter searchHighlighter) matches(content string, displayOffset int) [][]int {
	var matches [][]int
	for _, filter := range highlighter.filters {
		if filter.Config.Invert {
			continue
		}
		byteRanges := filter.Re.FindAllStringIndex(content, -1)
		matches = append(matches, highlighter.mapper.fromByteRanges(content, byteRanges, displayOffset)...)
	}
	if matches == nil {
		return [][]int{}
	}
	return matches
}

func (highlighter searchHighlighter) displayLiteralMatch(displayText string, content string) [][]int {
	return highlighter.literalMatch(content, highlighter.contentOffset(displayText, content))
}

func (highlighter searchHighlighter) literalMatch(content string, displayOffset int) [][]int {
	if content == "" {
		return [][]int{}
	}
	return [][]int{{displayOffset, displayOffset + highlighter.mapper.length(content)}}
}
