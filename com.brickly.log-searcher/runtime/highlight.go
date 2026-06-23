package main

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
	ranges := make([][]int, 0, len(byteRanges))
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

		start := offset + mapper.byteOffset(value, startByte)
		end := offset + mapper.byteOffset(value, endByte)
		if start < end {
			ranges = append(ranges, []int{start, end})
		}
	}
	return ranges
}

func (mapper utf16RangeMapper) byteOffset(value string, byteOffset int) int {
	if byteOffset <= 0 {
		return 0
	}

	utf16Offset := 0
	for currentByteOffset, r := range value {
		if currentByteOffset >= byteOffset {
			return utf16Offset
		}
		if r > 0xFFFF {
			utf16Offset += 2
		} else {
			utf16Offset++
		}
	}

	return utf16Offset
}

// searchHighlighter 是 matches 的统一生成入口。本地、SSH、onlyMatch 都从这里输出坐标。
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
