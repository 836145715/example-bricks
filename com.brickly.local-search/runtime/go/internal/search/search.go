package search

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

const (
	DefaultLimit = 50
	MaxLimit     = 200
)

type Category string

const (
	CategoryAll     Category = "all"
	CategoryFile    Category = "file"
	CategoryFolder  Category = "folder"
	CategoryExcel   Category = "excel"
	CategoryWord    Category = "word"
	CategoryPPT     Category = "ppt"
	CategoryPDF     Category = "pdf"
	CategoryImage   Category = "image"
	CategoryVideo   Category = "video"
	CategoryAudio   Category = "audio"
	CategoryArchive Category = "archive"
)

type Params struct {
	Query          string   `json:"query"`
	Category       Category `json:"category"`
	Offset         uint32   `json:"offset"`
	Limit          uint32   `json:"limit"`
	Sort           string   `json:"sort"`
	EffectiveQuery string   `json:"effectiveQuery"`
}

type rawParams struct {
	Query    string `json:"query"`
	Category string `json:"category"`
	Offset   any    `json:"offset"`
	Limit    any    `json:"limit"`
	Sort     string `json:"sort"`
}

var tokenPattern = regexp.MustCompile(`^[a-z]+:$`)

func ParseInput(input json.RawMessage) (Params, error) {
	var raw rawParams
	if len(input) > 0 {
		if err := json.Unmarshal(input, &raw); err != nil {
			return Params{}, fmt.Errorf("解析搜索参数失败: %w", err)
		}
	}

	category := Category(strings.TrimSpace(raw.Category))
	if category == "" {
		category = CategoryAll
	}
	if _, ok := categoryFilters[category]; !ok {
		return Params{}, fmt.Errorf("不支持的搜索分类: %s", category)
	}

	offset, err := numberField(raw.Offset, 0)
	if err != nil {
		return Params{}, fmt.Errorf("offset %w", err)
	}
	limit, err := numberField(raw.Limit, DefaultLimit)
	if err != nil {
		return Params{}, fmt.Errorf("limit %w", err)
	}
	if offset < 0 {
		offset = 0
	}
	if limit <= 0 {
		limit = DefaultLimit
	}
	if limit > MaxLimit {
		limit = MaxLimit
	}

	sort := strings.TrimSpace(raw.Sort)
	if sort == "" {
		sort = "name_asc"
	}
	if _, ok := sortValues[sort]; !ok {
		return Params{}, fmt.Errorf("不支持的排序方式: %s", sort)
	}

	query := strings.TrimSpace(raw.Query)
	return Params{
		Query:          query,
		Category:       category,
		Offset:         uint32(offset),
		Limit:          uint32(limit),
		Sort:           sort,
		EffectiveQuery: BuildQuery(query, category),
	}, nil
}

func BuildQuery(query string, category Category) string {
	query = strings.TrimSpace(query)
	filter := categoryFilters[category]
	if filter == "" {
		if query == "" {
			return "*"
		}
		return query
	}
	if query == "" {
		return filter
	}
	if tokenPattern.MatchString(filter) {
		return strings.TrimSpace(filter + query)
	}
	return strings.TrimSpace(filter + " " + query)
}

func SortCode(sort string) uint32 {
	return sortValues[sort]
}

func CategoryLabel(category Category) string {
	if label := categoryLabels[category]; label != "" {
		return label
	}
	return string(category)
}

func numberField(value any, fallback int) (int, error) {
	if value == nil {
		return fallback, nil
	}
	switch v := value.(type) {
	case float64:
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
			return 0, errors.New("必须是数字")
		}
		return n, nil
	default:
		return 0, errors.New("必须是数字")
	}
}

var categoryFilters = map[Category]string{
	CategoryAll:     "",
	CategoryFile:    "file:",
	CategoryFolder:  "folder:",
	CategoryExcel:   "file: ext:xls;xlsx;xlsm;xlsb;csv",
	CategoryWord:    "file: ext:doc;docx;docm;rtf",
	CategoryPPT:     "file: ext:ppt;pptx;pptm;pps;ppsx",
	CategoryPDF:     "file: ext:pdf",
	CategoryImage:   "file: ext:jpg;jpeg;png;gif;webp;bmp;ico;svg;tif;tiff",
	CategoryVideo:   "file: ext:mp4;mkv;avi;mov;wmv;flv;webm;m4v;mpeg;mpg",
	CategoryAudio:   "file: ext:mp3;wav;flac;ape;aac;m4a;ogg;wma",
	CategoryArchive: "file: ext:zip;rar;7z;tar;gz;bz2;xz;iso",
}

var categoryLabels = map[Category]string{
	CategoryAll:     "全部",
	CategoryFile:    "文件",
	CategoryFolder:  "文件夹",
	CategoryExcel:   "Excel",
	CategoryWord:    "Word",
	CategoryPPT:     "PPT",
	CategoryPDF:     "PDF",
	CategoryImage:   "图片",
	CategoryVideo:   "视频",
	CategoryAudio:   "音频",
	CategoryArchive: "压缩文件",
}

const (
	sortNameAscending          uint32 = 1
	sortNameDescending         uint32 = 2
	sortPathAscending          uint32 = 3
	sortPathDescending         uint32 = 4
	sortSizeAscending          uint32 = 5
	sortSizeDescending         uint32 = 6
	sortExtensionAscending     uint32 = 7
	sortExtensionDescending    uint32 = 8
	sortDateModifiedAscending  uint32 = 13
	sortDateModifiedDescending uint32 = 14
)

var sortValues = map[string]uint32{
	"name_asc":  sortNameAscending,
	"name_desc": sortNameDescending,
	"path_asc":  sortPathAscending,
	"path_desc": sortPathDescending,
	"size_asc":  sortSizeAscending,
	"size_desc": sortSizeDescending,
	"ext_asc":   sortExtensionAscending,
	"ext_desc":  sortExtensionDescending,
	"date_asc":  sortDateModifiedAscending,
	"date_desc": sortDateModifiedDescending,
}
