// SSH 日志检索使用的过滤、输出分组和行格式化逻辑。
package main

import (
	"context"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// GrepLine 单行检索结果，包含预计算的高亮位置。
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

type grepOutputItem struct {
	lineNum   int
	sequence  int
	sourceKey string
	isMatch   bool
	content   string
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

	return emitMatchOutputItems(ctx, items, onLine)
}

func emitMatchOutputGroups(ctx context.Context, groups []*matchOutputGroup, onLine func(line GrepLine)) error {
	for _, group := range groups {
		if err := emitMatchOutputItems(ctx, group.items, onLine); err != nil {
			return err
		}
	}
	return nil
}

func emitMatchOutputItems(ctx context.Context, items []grepOutputItem, onLine func(line GrepLine)) error {
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
