// SSH 日志检索使用的过滤、输出分组和行格式化逻辑。
package main

import (
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var errSearchLineLimit = errors.New("search line limit reached")

type grepLineHandler func(line GrepLine) (stop bool)

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
	for _, filterConfig := range filterConfigs {
		re, err := buildFilterRegexp(filterConfig.Pattern, filterConfig.Regexp, filterConfig.WordRegexp, filterConfig.IgnoreCase)
		if err != nil {
			return nil, fmt.Errorf("invalid filter %q: %w", filterConfig.Pattern, err)
		}
		compiled = append(compiled, compiledFilter{Config: filterConfig, Re: re})
	}
	return compiled, nil
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
