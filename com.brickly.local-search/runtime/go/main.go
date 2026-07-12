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
	"brickly/local-search/internal/stdoutguard"
	brickly "github.com/836145715/brickly-sdk-go"
)

const (
	brickID         = "com.brickly.local-search"
	protocolVersion = "0.1.0"
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
	Total          uint32            `json:"total"`
	Offset         uint32            `json:"offset"`
	Limit          uint32            `json:"limit"`
	Items          []everything.Item `json:"items"`
}

func handleSearch(_ *brickly.CommandContext, input json.RawMessage) (any, error) {
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
	return searchResponse{
		Query:          params.Query,
		EffectiveQuery: params.EffectiveQuery,
		Category:       params.Category,
		CategoryLabel:  search.CategoryLabel(params.Category),
		Total:          result.Total,
		Offset:         result.Offset,
		Limit:          result.Limit,
		Items:          result.Items,
	}, nil
}

func handleHealth(_ *brickly.CommandContext, _ json.RawMessage) (any, error) {
	return client.Health(buildStamp), nil
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
	return result, nil
}

func handleQuickSearch(_ *brickly.CommandContext, input json.RawMessage) (any, error) {
	params, err := quicksearch.ParseSearchInput(input)
	if err != nil {
		return nil, brickly.NewBppError("INVALID_INPUT", err.Error())
	}
	if params.Query == "" {
		return quicksearch.SearchOutput{Results: []quicksearch.ProviderItem{}}, nil
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
	return quicksearch.BuildOutput(result.Items, params.Limit), nil
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

func toBppError(err error) error {
	var sdkErr *everything.SDKError
	if errors.As(err, &sdkErr) {
		code := "EVERYTHING_ERROR"
		if sdkErr.Code == everything.ErrorIPC {
			code = "EVERYTHING_NOT_RUNNING"
		}
		if sdkErr.Code == everything.ErrorInvalidParameter {
			code = "INVALID_INPUT"
		}
		return brickly.NewBppError(code, sdkErr.Error(), map[string]any{"everythingCode": sdkErr.Code})
	}
	return brickly.NewBppError("EVERYTHING_ERROR", err.Error())
}

func main() {
	plugin = brickly.New(brickly.Options{
		BrickID:         brickID,
		ProtocolVersion: protocolVersion,
		Stdout:          stdoutguard.ProtocolStdout(),
	})
	plugin.Info(fmt.Sprintf("started go=%s os=%s arch=%s dll=%s", runtime.Version(), runtime.GOOS, runtime.GOARCH, client.DLLPath()), nil)

	plugin.OnCommand("search", handleSearch)
	plugin.OnCommand("health", handleHealth)
	plugin.OnCommand("preview", handlePreview)
	plugin.OnCommand("quick-search", handleQuickSearch)
	plugin.OnCommand("quick-search-open", handleQuickSearchOpen)

	plugin.Start()
}

