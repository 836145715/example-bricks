package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"runtime"

	"brickly/local-search/internal/everything"
	"brickly/local-search/internal/preview"
	"brickly/local-search/internal/quicksearch"
	"brickly/local-search/internal/search"
	brickly "github.com/836145715/brickly-sdk-go"
)


var (
	buildStamp = "dev"
	client     = everything.NewClient(everything.DefaultDLLPath())
	plugin     *brickly.Runtime
)

type searchResponse struct {
	Query          string            `json:"query"`
	EffectiveQuery string            `json:"effectiveQuery"`
	Category       search.Category   `json:"category"`
	CategoryLabel  string            `json:"categoryLabel"`
	Total          int64             `json:"total"`
	Offset         int64             `json:"offset"`
	Limit          int64             `json:"limit"`
	Items          []everything.Item `json:"items"`
}

// asJSONValue 把结构体收成 BrickValue 能编码的 JSON 值。
// Everything 的 size / attributes 是无符号整数，直接返回结构体会卡在 uint64。
func asJSONValue(value any) (any, error) {
	if value == nil {
		return nil, nil
	}
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var decoded any
	if err := json.Unmarshal(data, &decoded); err != nil {
		return nil, err
	}
	return decoded, nil
}

func handleSearch(_ *brickly.CommandContext, input json.RawMessage) (any, error) {
	if err := requireIndexReady(); err != nil {
		return nil, err
	}
	params, err := search.ParseInput(input)
	if err != nil {
		return nil, brickly.NewBppError("INVALID_INPUT", err.Error())
	}
	result, err := client.Search(everything.SearchOptions{
		Query:  params.EffectiveQuery,
		Offset: params.Offset,
		Limit:  params.Limit,
		Sort:   search.SortCode(params.Sort),
	})
	if err != nil {
		return nil, toBppError(err)
	}
	return asJSONValue(searchResponse{
		Query:          params.Query,
		EffectiveQuery: params.EffectiveQuery,
		Category:       params.Category,
		CategoryLabel:  search.CategoryLabel(params.Category),
		Total:          int64(result.Total),
		Offset:         int64(result.Offset),
		Limit:          int64(result.Limit),
		Items:          result.Items,
	})
}

func handleHealth(_ *brickly.CommandContext, _ json.RawMessage) (any, error) {
	return asJSONValue(client.Health(buildStamp))
}

func handlePreview(_ *brickly.CommandContext, input json.RawMessage) (any, error) {
	params, err := preview.ParseInput(input)
	if err != nil {
		return nil, brickly.NewBppError("INVALID_INPUT", err.Error())
	}
	result, err := preview.Build(params)
	if err != nil {
		return nil, brickly.NewBppError("PREVIEW_ERROR", err.Error())
	}
	return asJSONValue(result)
}

func handleQuickSearch(_ *brickly.CommandContext, input json.RawMessage) (any, error) {
	params, err := quicksearch.ParseSearchInput(input)
	if err != nil {
		return nil, brickly.NewBppError("INVALID_INPUT", err.Error())
	}
	if params.Query == "" {
		return asJSONValue(quicksearch.SearchOutput{Results: []quicksearch.ProviderItem{}})
	}
	if health := client.Health(buildStamp); !health.OK {
		return asJSONValue(quicksearch.SearchOutput{Results: []quicksearch.ProviderItem{}})
	}

	result, err := client.Search(everything.SearchOptions{
		Query:  search.BuildQuery(params.Query, search.CategoryAll),
		Offset: 0,
		Limit:  uint32(params.Limit),
		Sort:   search.SortCode("date_desc"),
	})
	if err != nil {
		return nil, toBppError(err)
	}
	return asJSONValue(quicksearch.BuildOutput(result.Items, params.Limit))
}

func handleQuickSearchOpen(_ *brickly.CommandContext, input json.RawMessage) (any, error) {
	params, err := quicksearch.ParseActivateInput(input)
	if err != nil {
		return nil, brickly.NewBppError("INVALID_INPUT", err.Error())
	}
	if err := openLocalPath(params.Path); err != nil {
		return nil, brickly.NewBppError("OPEN_FAILED", err.Error())
	}
	return map[string]string{"message": quicksearch.OpenedMessage(params)}, nil
}

func requireIndexReady() error {
	health := client.Health(buildStamp)
	if health.OK {
		return nil
	}
	code := "EVERYTHING_ERROR"
	switch health.Reason {
	case everything.ReasonNotInstalled:
		code = "EVERYTHING_NOT_INSTALLED"
	case everything.ReasonNotRunning:
		code = "EVERYTHING_NOT_RUNNING"
	case everything.ReasonIndexing:
		code = "EVERYTHING_INDEXING"
	case everything.ReasonIpcUnavailable:
		code = "EVERYTHING_IPC_UNAVAILABLE"
	}
	message := health.EverythingError
	if message == "" {
		message = everything.ReasonMessage(health.Reason)
	}
	return brickly.NewBppError(code, message)
}

func toBppError(err error) error {
	var sdkErr *everything.SDKError
	if errors.As(err, &sdkErr) {
		code := "EVERYTHING_ERROR"
		message := sdkErr.Error()
		if sdkErr.Code == everything.ErrorIPC {
			if !everything.BundledExeExists() {
				code = "EVERYTHING_NOT_INSTALLED"
				message = everything.ReasonMessage(everything.ReasonNotInstalled)
			} else {
				code = "EVERYTHING_NOT_RUNNING"
				message = everything.ReasonMessage(everything.ReasonNotRunning)
			}
		}
		if sdkErr.Code == everything.ErrorInvalidParameter {
			code = "INVALID_INPUT"
		}
		return brickly.NewBppError(code, message, map[string]any{"everythingCode": sdkErr.Code})
	}
	return brickly.NewBppError("EVERYTHING_ERROR", err.Error())
}

func main() {
	plugin = brickly.New()
	plugin.Info(fmt.Sprintf("started go=%s os=%s arch=%s dll=%s", runtime.Version(), runtime.GOOS, runtime.GOARCH, client.DLLPath()), nil)

	plugin.OnCommand("search", handleSearch)
	plugin.OnCommand("health", handleHealth)
	plugin.OnCommand("preview", handlePreview)
	plugin.OnCommand("quick-search", handleQuickSearch)
	plugin.OnCommand("quick-search-open", handleQuickSearchOpen)

	plugin.Start()
}

