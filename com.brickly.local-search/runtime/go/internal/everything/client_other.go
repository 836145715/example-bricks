//go:build !windows

package everything

import (
	"runtime"
)

func NewClient(dllPath string) *Client {
	return &Client{dllPath: dllPath}
}

func (c *Client) DLLPath() string {
	return c.dllPath
}

func (c *Client) Search(SearchOptions) (SearchResult, error) {
	return SearchResult{}, &SDKError{Code: ErrorInvalidCall, Text: "本地搜索 Brick 第一版仅支持 Windows x64"}
}

func (c *Client) Health(buildStamp string) Health {
	return Health{
		OK:              false,
		Reason:          ReasonUnsupported,
		Platform:        runtime.GOOS,
		Architecture:    runtime.GOARCH,
		GoVersion:       runtime.Version(),
		BuildStamp:      buildStamp,
		DLLPath:         c.dllPath,
		DLLExists:       false,
		DLLLoaded:       false,
		IPCReady:        false,
		DownloadURL:     DownloadURL,
		Error:           ReasonMessage(ReasonUnsupported),
		EverythingError: ReasonMessage(ReasonUnsupported),
		CheckedAt:       nowMillis(),
	}
}

func DefaultDLLPath() string {
	return BundledDLLPath()
}
