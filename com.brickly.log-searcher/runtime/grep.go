// 纯 Go 实现的本地 Grep 引擎，支持通配符展开、大小写敏感、正则、反向过滤与上下文行
package main

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// GrepLine 单行检索结果，包含预计算的高亮位置
type GrepLine struct {
	Text      string  `json:"text"`
	Matches   [][]int `json:"matches"` // 匹配区间 [start, end)，相对于 Text
	File      string  `json:"file,omitempty"`
	IsContext bool    `json:"isContext,omitempty"`
	Error     string  `json:"error,omitempty"`
}

type compiledFilter struct {
	Config FilterConfig
	Re     *regexp.Regexp
}

func buildFilterRegexp(pattern string, regexpMode bool, wordRegexp bool, ignoreCase bool) (*regexp.Regexp, error) {
	rePattern := pattern
	if !regexpMode {
		rePattern = regexp.QuoteMeta(pattern)
	}
	if wordRegexp {
		rePattern = `\b` + rePattern + `\b`
	}
	if ignoreCase {
		rePattern = `(?i)` + rePattern
	}
	return regexp.Compile(rePattern)
}

func buildEffectiveFilters(pattern string, args GrepArgs) []FilterConfig {
	filters := make([]FilterConfig, 0, len(args.Filters)+1)
	if strings.TrimSpace(pattern) != "" {
		filters = append(filters, FilterConfig{
			Pattern:    pattern,
			Regexp:     args.Regexp,
			IgnoreCase: args.IgnoreCase,
			Invert:     args.Invert,
			WordRegexp: args.WordRegexp,
		})
	}
	for _, filter := range args.Filters {
		if strings.TrimSpace(filter.Pattern) == "" {
			continue
		}
		filters = append(filters, filter)
	}
	return filters
}

func compileFilters(pattern string, args GrepArgs) ([]compiledFilter, error) {
	filterConfigs := buildEffectiveFilters(pattern, args)
	compiled := make([]compiledFilter, 0, len(filterConfigs))
	for _, filter := range filterConfigs {
		re, err := buildFilterRegexp(filter.Pattern, filter.Regexp, filter.WordRegexp, filter.IgnoreCase)
		if err != nil {
			return nil, fmt.Errorf("invalid filter %q: %w", filter.Pattern, err)
		}
		compiled = append(compiled, compiledFilter{Config: filter, Re: re})
	}
	return compiled, nil
}

func matchesAllFilters(text string, filters []compiledFilter) bool {
	for _, filter := range filters {
		matched := filter.Re.MatchString(text)
		if filter.Config.Invert {
			matched = !matched
		}
		if !matched {
			return false
		}
	}
	return true
}

func primaryFilter(filters []compiledFilter) *compiledFilter {
	if len(filters) == 0 {
		return nil
	}
	return &filters[0]
}

// 本地 Grep 执行器
func RunLocalGrep(ctx context.Context, pattern string, files []string, args GrepArgs, onLine func(line GrepLine)) error {
	// 1. 展开本地通配符与目录路径
	targetFiles, err := ExpandLocalPaths(files)
	if err != nil {
		return err
	}

	filters, err := compileFilters(pattern, args)
	if err != nil {
		return err
	}

	// 确定上下文参数
	contextA := args.ContextA
	contextB := args.ContextB
	if args.ContextC > 0 {
		contextA = args.ContextC
		contextB = args.ContextC
	}

	// 3. 逐个文件扫描。maxCount 是“每文件最新 N 条命中”，不能跨文件共享计数。
	for _, filePath := range targetFiles {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		file, err := os.Open(filePath)
		if err != nil {
			message := fmt.Sprintf("failed to open file %s: %v", filePath, err)
			logf("%s", message)
			onLine(GrepLine{
				Text:  message,
				File:  filePath,
				Error: message,
			})
			continue
		}

		// 执行单个文件的过滤
		err = grepSingleFile(ctx, file, filePath, filepath.Base(filePath), filters, args, contextA, contextB, onLine)
		file.Close()
		if err != nil {
			return err
		}
	}

	return nil
}

// 缓存行结构（包含行号和内容）
type lineInfo struct {
	lineNum int
	text    string
}

type grepOutputItem struct {
	lineNum   int
	sequence  int
	sourceKey string
	isMatch   bool
	line      GrepLine
}

type matchOutputGroup struct {
	matchLineNum int
	items        []grepOutputItem
}

func (group *matchOutputGroup) add(item grepOutputItem) {
	group.items = append(group.items, item)
}

type matchOutputGroupRing struct {
	limit  int
	buffer []*matchOutputGroup
	start  int
	count  int
}

func newMatchOutputGroupRing(limit int) *matchOutputGroupRing {
	return &matchOutputGroupRing{limit: limit}
}

func (ring *matchOutputGroupRing) add(group *matchOutputGroup) *matchOutputGroup {
	if ring.limit <= 0 {
		return nil
	}

	if len(ring.buffer) < ring.limit {
		ring.buffer = append(ring.buffer, group)
		ring.count++
		return nil
	}

	if ring.count < ring.limit {
		index := (ring.start + ring.count) % ring.limit
		ring.buffer[index] = group
		ring.count++
		return nil
	}

	evicted := ring.buffer[ring.start]
	ring.buffer[ring.start] = group
	ring.start = (ring.start + 1) % ring.limit
	return evicted
}

func (ring *matchOutputGroupRing) groupsOldestFirst() []*matchOutputGroup {
	if ring.count == 0 {
		return nil
	}

	groups := make([]*matchOutputGroup, 0, ring.count)
	for i := 0; i < ring.count; i++ {
		groups = append(groups, ring.buffer[(ring.start+i)%len(ring.buffer)])
	}
	return groups
}

func removeOpenMatchGroup(groups []*matchOutputGroup, target *matchOutputGroup) []*matchOutputGroup {
	if target == nil {
		return groups
	}

	kept := groups[:0]
	for _, group := range groups {
		if group != target {
			kept = append(kept, group)
		}
	}
	return kept
}

func pruneOpenMatchGroups(groups []*matchOutputGroup, currentLineNum int, contextA int) []*matchOutputGroup {
	if contextA <= 0 {
		return groups[:0]
	}

	kept := groups[:0]
	for _, group := range groups {
		if currentLineNum-group.matchLineNum < contextA {
			kept = append(kept, group)
		}
	}
	return kept
}

func flushMatchOutputGroups(ctx context.Context, groups []*matchOutputGroup, onLine func(line GrepLine)) error {
	if len(groups) == 0 {
		return nil
	}

	hasMatchByLine := make(map[string]bool)
	for _, group := range groups {
		for _, item := range group.items {
			if item.isMatch {
				hasMatchByLine[item.dedupeKey()] = true
			}
		}
	}

	items := make([]grepOutputItem, 0)
	seenContextLine := make(map[string]bool)
	for _, group := range groups {
		for _, item := range group.items {
			if !item.isMatch {
				key := item.dedupeKey()
				if hasMatchByLine[key] || seenContextLine[key] {
					continue
				}
				seenContextLine[key] = true
			}
			items = append(items, item)
		}
	}

	sort.SliceStable(items, func(i, j int) bool {
		if items[i].lineNum != items[j].lineNum {
			return items[i].lineNum < items[j].lineNum
		}
		return items[i].sequence < items[j].sequence
	})

	for _, item := range items {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		onLine(item.line)
	}
	return nil
}

func (item grepOutputItem) dedupeKey() string {
	return item.sourceKey + ":" + strconv.Itoa(item.lineNum)
}

// 根据 ShowFilename 和 ShowLineNum 动态组合前缀
func formatLine(filename string, lineNum int, text string, isContext bool, args GrepArgs) string {
	var prefix strings.Builder
	if args.ShowFilename {
		prefix.WriteString(filename)
	}
	if args.ShowLineNum {
		if prefix.Len() > 0 {
			if isContext {
				prefix.WriteString("-")
			} else {
				prefix.WriteString(":")
			}
		}
		prefix.WriteString(strconv.Itoa(lineNum))
	}
	if prefix.Len() > 0 {
		if isContext {
			prefix.WriteString("-")
		} else {
			prefix.WriteString(":")
		}
	}
	prefix.WriteString(text)
	return prefix.String()
}

func grepSingleFile(ctx context.Context, file *os.File, filePath string, filename string, filters []compiledFilter, args GrepArgs, contextA, contextB int, onLine func(line GrepLine)) error {
	lineSource, err := newSearchLineSource(ctx, file, args)
	if err != nil {
		logf("error reading file %s: %v", filename, err)
		return nil
	}
	defer lineSource.Close()

	mainFilter := primaryFilter(filters)
	highlighter := newSearchHighlighter(filters)

	// makeLine 格式化并预计算高亮位置
	makeLine := func(ln int, text string, isCtx bool) GrepLine {
		formatted := formatLine(filename, ln, text, isCtx, args)
		return GrepLine{
			Text:      formatted,
			Matches:   highlighter.displayMatches(formatted, text),
			File:      filePath,
			IsContext: isCtx,
		}
	}
	makeOnlyMatchLine := func(ln int, text string) GrepLine {
		formatted := formatLine(filename, ln, text, false, args)
		return GrepLine{
			Text:    formatted,
			Matches: highlighter.displayLiteralMatch(formatted, text),
			File:    filePath,
		}
	}

	if args.MaxCount > 0 {
		err = grepSingleFileBuffered(ctx, lineSource, filePath, filters, args, contextA, contextB, mainFilter, makeLine, makeOnlyMatchLine, onLine)
	} else {
		err = grepSingleFileStreaming(ctx, lineSource, filters, args, contextA, contextB, mainFilter, makeLine, makeOnlyMatchLine, onLine)
	}
	if err != nil {
		return err
	}

	if err := lineSource.Err(); err != nil {
		logf("error reading file %s: %v", filename, err)
	}

	return nil
}

func grepSingleFileStreaming(
	ctx context.Context,
	lineSource searchLineSource,
	filters []compiledFilter,
	args GrepArgs,
	contextA int,
	contextB int,
	mainFilter *compiledFilter,
	makeLine func(ln int, text string, isCtx bool) GrepLine,
	makeOnlyMatchLine func(ln int, text string) GrepLine,
	onLine func(line GrepLine),
) error {
	// 历史行缓冲区（保存前 B 行）
	var history []lineInfo
	// 剩余需要打印的后文行数
	remainingA := 0
	// 记录最后一次输出的行号，防重叠
	lastPrintedLine := 0

	for lineSource.Next() {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		lineNum, text := lineSource.Line()
		matched := matchesAllFilters(text, filters)

		if matched {
			// 1. 如果配置了前文行，先输出未被输出的前文
			if contextB > 0 {
				for _, hist := range history {
					if hist.lineNum > lastPrintedLine {
						onLine(makeLine(hist.lineNum, hist.text, true))
						lastPrintedLine = hist.lineNum
					}
				}
			}

			// 2. 输出匹配行
			if args.OnlyMatch && mainFilter != nil && !mainFilter.Config.Invert {
				matches := mainFilter.Re.FindAllString(text, -1)
				for _, m := range matches {
					if ctx.Err() != nil {
						return ctx.Err()
					}
					onLine(makeOnlyMatchLine(lineNum, m))
				}
			} else {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				onLine(makeLine(lineNum, text, false))
			}
			lastPrintedLine = lineNum

			// 3. 设定后文输出计数器
			remainingA = contextA

		} else {
			// 未直接匹配，但由于前面有匹配，处于后文输出范围
			if remainingA > 0 {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				onLine(makeLine(lineNum, text, true))
				lastPrintedLine = lineNum
				remainingA--
			}
		}

		// 更新前文环形缓冲区
		if contextB > 0 {
			history = append(history, lineInfo{lineNum: lineNum, text: text})
			if len(history) > contextB {
				history = history[1:]
			}
		}
	}

	return nil
}

func grepSingleFileBuffered(
	ctx context.Context,
	lineSource searchLineSource,
	sourceKey string,
	filters []compiledFilter,
	args GrepArgs,
	contextA int,
	contextB int,
	mainFilter *compiledFilter,
	makeLine func(ln int, text string, isCtx bool) GrepLine,
	makeOnlyMatchLine func(ln int, text string) GrepLine,
	onLine func(line GrepLine),
) error {
	groups := newMatchOutputGroupRing(args.MaxCount)
	var openGroups []*matchOutputGroup
	var history []lineInfo
	sequence := 0
	nextSequence := func() int {
		sequence++
		return sequence
	}

	for lineSource.Next() {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		lineNum, text := lineSource.Line()
		matched := matchesAllFilters(text, filters)

		if matched {
			if contextA > 0 {
				openGroups = pruneOpenMatchGroups(openGroups, lineNum, contextA)
			}

			group := &matchOutputGroup{matchLineNum: lineNum}
			if contextB > 0 {
				for _, hist := range history {
					group.add(grepOutputItem{
						lineNum:   hist.lineNum,
						sequence:  nextSequence(),
						sourceKey: sourceKey,
						isMatch:   false,
						line:      makeLine(hist.lineNum, hist.text, true),
					})
				}
			}

			if args.OnlyMatch && mainFilter != nil && !mainFilter.Config.Invert {
				matches := mainFilter.Re.FindAllString(text, -1)
				for _, match := range matches {
					if ctx.Err() != nil {
						return ctx.Err()
					}
					group.add(grepOutputItem{
						lineNum:   lineNum,
						sequence:  nextSequence(),
						sourceKey: sourceKey,
						isMatch:   true,
						line:      makeOnlyMatchLine(lineNum, match),
					})
				}
			} else {
				group.add(grepOutputItem{
					lineNum:   lineNum,
					sequence:  nextSequence(),
					sourceKey: sourceKey,
					isMatch:   true,
					line:      makeLine(lineNum, text, false),
				})
			}

			evicted := groups.add(group)
			openGroups = removeOpenMatchGroup(openGroups, evicted)
			if contextA > 0 {
				openGroups = append(openGroups, group)
			}
		} else if contextA > 0 {
			for _, group := range openGroups {
				if lineNum > group.matchLineNum && lineNum-group.matchLineNum <= contextA {
					group.add(grepOutputItem{
						lineNum:   lineNum,
						sequence:  nextSequence(),
						sourceKey: sourceKey,
						isMatch:   false,
						line:      makeLine(lineNum, text, true),
					})
				}
			}
			openGroups = pruneOpenMatchGroups(openGroups, lineNum, contextA)
		}

		if contextB > 0 {
			history = append(history, lineInfo{lineNum: lineNum, text: text})
			if len(history) > contextB {
				history = history[1:]
			}
		}
	}

	return flushMatchOutputGroups(ctx, groups.groupsOldestFirst(), onLine)
}

type searchLineSource interface {
	Next() bool
	Line() (int, string)
	Err() error
	Close()
}

func newSearchLineSource(ctx context.Context, file *os.File, args GrepArgs) (searchLineSource, error) {
	if args.FromTail && args.TailLines > 0 {
		return newTailLineSource(ctx, file, args.TailLines)
	}
	return newStreamingLineSource(file), nil
}

type streamingLineSource struct {
	scanner *bufio.Scanner
	lineNum int
	text    string
}

func newStreamingLineSource(file *os.File) *streamingLineSource {
	scanner := newLogScanner(file)
	return &streamingLineSource{scanner: scanner}
}

func (source *streamingLineSource) Next() bool {
	if !source.scanner.Scan() {
		return false
	}
	source.lineNum++
	source.text = source.scanner.Text()
	return true
}

func (source *streamingLineSource) Line() (int, string) {
	return source.lineNum, source.text
}

func (source *streamingLineSource) Err() error {
	return source.scanner.Err()
}

func (source *streamingLineSource) Close() {}

type tailLineSource struct {
	lines        []string
	startLineNum int
	index        int
}

func newTailLineSource(ctx context.Context, file *os.File, tailLines int) (*tailLineSource, error) {
	lines, startLineNum, err := readTailLines(ctx, file, tailLines)
	if err != nil {
		return nil, err
	}
	return &tailLineSource{lines: lines, startLineNum: startLineNum, index: -1}, nil
}

func (source *tailLineSource) Next() bool {
	if source.index+1 >= len(source.lines) {
		return false
	}
	source.index++
	return true
}

func (source *tailLineSource) Line() (int, string) {
	return source.startLineNum + source.index, source.lines[source.index]
}

func (source *tailLineSource) Err() error {
	return nil
}

func (source *tailLineSource) Close() {
	source.lines = nil
}

func newLogScanner(file *os.File) *bufio.Scanner {
	scanner := bufio.NewScanner(file)
	// 支持单行最大 4MB
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	return scanner
}

func readTailLines(ctx context.Context, file *os.File, tailLines int) ([]string, int, error) {
	scanner := newLogScanner(file)
	buffer := make([]string, tailLines)
	next := 0
	count := 0
	totalLines := 0
	for scanner.Scan() {
		if ctx.Err() != nil {
			return nil, 1, ctx.Err()
		}
		buffer[next] = scanner.Text()
		next = (next + 1) % tailLines
		if count < tailLines {
			count++
		}
		totalLines++
	}
	if err := scanner.Err(); err != nil {
		return nil, 1, err
	}
	if count == 0 {
		return []string{}, 1, nil
	}

	lines := make([]string, 0, count)
	start := 0
	if count == tailLines {
		start = next
	}
	for i := 0; i < count; i++ {
		lines = append(lines, buffer[(start+i)%tailLines])
	}
	startLineNum := totalLines - count + 1
	return lines, startLineNum, nil
}

// 本地展开路径与通配符以获取真实文件列表
func ExpandLocalPaths(paths []string) ([]string, error) {
	var targetFiles []string
	for _, p := range paths {
		trimmedP := strings.TrimSpace(p)
		if trimmedP == "" {
			continue
		}

		// 1. 含有通配符，则 Glob 展开
		if strings.ContainsAny(trimmedP, "*?[]") {
			matches, err := filepath.Glob(trimmedP)
			if err == nil {
				for _, match := range matches {
					info, err := os.Stat(match)
					if err == nil && !info.IsDir() {
						targetFiles = append(targetFiles, match)
					}
				}
			}
			continue
		}

		// 2. 检查普通路径是否为目录
		info, err := os.Stat(trimmedP)
		if err != nil {
			// 如果不存在或是相对路径，暂时不展开
			continue
		}

		if info.IsDir() {
			// 展开目录下一级的所有常规文件
			entries, err := os.ReadDir(trimmedP)
			if err == nil {
				for _, entry := range entries {
					if !entry.IsDir() {
						targetFiles = append(targetFiles, filepath.Join(trimmedP, entry.Name()))
					}
				}
			}
		} else {
			targetFiles = append(targetFiles, trimmedP)
		}
	}
	return targetFiles, nil
}
