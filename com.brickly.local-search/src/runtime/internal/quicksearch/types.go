package quicksearch

import (
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"math"
	"strconv"
	"strings"

	"brickly/local-search/internal/everything"
)

const (
	DefaultLimit = 8
	MaxLimit     = 20
)

type SearchParams struct {
	ProviderID string
	Query      string
	Sequence   int
	Limit      int
}

type SearchOutput struct {
	Results []ProviderItem `json:"results"`
}

type ProviderItem struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Subtitle  string    `json:"subtitle,omitempty"`
	Accessory string    `json:"accessory,omitempty"`
	Category  string    `json:"category,omitempty"`
	Score     int       `json:"score,omitempty"`
	DedupeKey string    `json:"dedupeKey,omitempty"`
	Activate  *RouteRef `json:"activate,omitempty"`
}

// RouteInput 是 activate 路由载荷：宿主按 input 直调目标命令，业务字段不进消费方快照。
type RouteInput struct {
	Path  string `json:"path"`
	Title string `json:"title,omitempty"`
	Kind  string `json:"kind,omitempty"`
}

type RouteRef struct {
	Command string     `json:"command"`
	Input   RouteInput `json:"input"`
}

type OpenParams struct {
	Title string
	Path  string
	Kind  string
}

type rawSearchInput struct {
	ProviderID string `json:"providerId"`
	Query      string `json:"query"`
	Sequence   any    `json:"sequence"`
	Limit      any    `json:"limit"`
}

func ParseSearchInput(input json.RawMessage) (SearchParams, error) {
	var raw rawSearchInput
	if len(input) > 0 {
		if err := json.Unmarshal(input, &raw); err != nil {
			return SearchParams{}, fmt.Errorf("解析快速搜索参数失败: %w", err)
		}
	}

	sequence, err := numberField(raw.Sequence, 0)
	if err != nil {
		return SearchParams{}, fmt.Errorf("sequence %w", err)
	}
	limit, err := numberField(raw.Limit, DefaultLimit)
	if err != nil {
		return SearchParams{}, fmt.Errorf("limit %w", err)
	}
	if limit <= 0 {
		limit = DefaultLimit
	}
	if limit > MaxLimit {
		limit = MaxLimit
	}

	return SearchParams{
		ProviderID: strings.TrimSpace(raw.ProviderID),
		Query:      strings.TrimSpace(raw.Query),
		Sequence:   sequence,
		Limit:      limit,
	}, nil
}

func BuildOutput(items []everything.Item, limit int) SearchOutput {
	if limit <= 0 {
		limit = DefaultLimit
	}
	if limit > MaxLimit {
		limit = MaxLimit
	}

	results := make([]ProviderItem, 0, minInt(limit, len(items)))
	for _, item := range items {
		if len(results) >= limit {
			break
		}
		mapped, ok := MapItem(item, len(results))
		if ok {
			results = append(results, mapped)
		}
	}
	return SearchOutput{Results: results}
}

func MapItem(item everything.Item, index int) (ProviderItem, bool) {
	fullPath := resolveFullPath(item)
	if fullPath == "" {
		return ProviderItem{}, false
	}
	if !LooksLikeLocalPath(fullPath) {
		return ProviderItem{}, false
	}

	title := strings.TrimSpace(item.Name)
	if title == "" {
		title = baseName(fullPath)
	}
	if title == "" {
		title = fullPath
	}

	kind := "file"
	accessory := "文件"
	if item.IsFolder {
		kind = "folder"
		accessory = "文件夹"
	} else if extension := strings.TrimSpace(item.Extension); extension != "" {
		accessory = strings.ToUpper(strings.TrimPrefix(extension, "."))
	}

	return ProviderItem{
		ID:        kind + "-" + pathHash(fullPath),
		Title:     title,
		Subtitle:  fullPath,
		Accessory: accessory,
		Category:  "file",
		Score:     scoreForIndex(index),
		DedupeKey: "file:" + canonicalPath(fullPath),
		Activate: &RouteRef{
			Command: "quick-search-open",
			Input: RouteInput{
				Path:  fullPath,
				Title: title,
				Kind:  kind,
			},
		},
	}, true
}

func ParseOpenInput(input json.RawMessage) (OpenParams, error) {
	var raw RouteInput
	if len(input) > 0 {
		if err := json.Unmarshal(input, &raw); err != nil {
			return OpenParams{}, fmt.Errorf("解析快速搜索打开参数失败: %w", err)
		}
	}

	path := NormalizePath(raw.Path)
	if path == "" {
		return OpenParams{}, errors.New("快速搜索路由输入缺少 path")
	}
	if !LooksLikeLocalPath(path) {
		return OpenParams{}, fmt.Errorf("拒绝打开非本地绝对路径: %s", path)
	}

	return OpenParams{
		Title: strings.TrimSpace(raw.Title),
		Path:  path,
		Kind:  strings.TrimSpace(raw.Kind),
	}, nil
}

func OpenedMessage(params OpenParams) string {
	title := strings.TrimSpace(params.Title)
	if title == "" {
		title = baseName(params.Path)
	}
	if title == "" {
		return "已打开本地文件"
	}
	return "已打开 " + title
}

func NormalizePath(path string) string {
	path = strings.TrimSpace(path)
	path = strings.Trim(path, "\x00")
	return path
}

func LooksLikeLocalPath(path string) bool {
	path = NormalizePath(path)
	if strings.HasPrefix(path, `\\`) {
		return len(path) > 2
	}
	if len(path) < 3 {
		return false
	}
	drive := path[0]
	return ((drive >= 'A' && drive <= 'Z') || (drive >= 'a' && drive <= 'z')) &&
		path[1] == ':' &&
		(path[2] == '\\' || path[2] == '/')
}

func numberField(value any, fallback int) (int, error) {
	if value == nil {
		return fallback, nil
	}
	switch v := value.(type) {
	case float64:
		if math.IsNaN(v) || math.IsInf(v, 0) || math.Trunc(v) != v {
			return 0, errors.New("必须是整数")
		}
		return int(v), nil
	case int:
		return v, nil
	case json.Number:
		n, err := v.Int64()
		return int(n), err
	case string:
		if strings.TrimSpace(v) == "" {
			return fallback, nil
		}
		n, err := strconv.Atoi(strings.TrimSpace(v))
		if err != nil {
			return 0, errors.New("必须是整数")
		}
		return n, nil
	default:
		return 0, errors.New("必须是整数")
	}
}

func resolveFullPath(item everything.Item) string {
	if fullPath := NormalizePath(item.FullPath); fullPath != "" {
		return fullPath
	}
	dir := NormalizePath(item.Path)
	name := strings.TrimSpace(item.Name)
	if dir == "" {
		return name
	}
	if name == "" {
		return dir
	}
	separator := `\`
	if strings.Contains(dir, "/") && !strings.Contains(dir, `\`) {
		separator = "/"
	}
	if strings.HasSuffix(dir, `\`) || strings.HasSuffix(dir, "/") {
		return dir + name
	}
	return dir + separator + name
}

func baseName(path string) string {
	path = strings.TrimRight(NormalizePath(path), `\/`)
	if path == "" {
		return ""
	}
	index := strings.LastIndexAny(path, `\/`)
	if index < 0 {
		return path
	}
	return path[index+1:]
}

func canonicalPath(path string) string {
	return strings.ToLower(strings.ReplaceAll(NormalizePath(path), "/", `\`))
}

func pathHash(path string) string {
	hash := fnv.New64a()
	_, _ = hash.Write([]byte(canonicalPath(path)))
	return fmt.Sprintf("%016x", hash.Sum64())
}

func scoreForIndex(index int) int {
	score := 94 - index*3
	if score < 50 {
		return 50
	}
	return score
}

func minInt(a int, b int) int {
	if a < b {
		return a
	}
	return b
}
