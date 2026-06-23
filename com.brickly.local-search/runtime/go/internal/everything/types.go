package everything

import "time"

type Client struct {
	dllPath string
}

type SearchOptions struct {
	Query  string
	Offset uint32
	Limit  uint32
	Sort   uint32
}

type SearchResult struct {
	Total  uint32 `json:"total"`
	Offset uint32 `json:"offset"`
	Limit  uint32 `json:"limit"`
	Items  []Item `json:"items"`
}

type Item struct {
	Name         string `json:"name"`
	Path         string `json:"path"`
	FullPath     string `json:"fullPath"`
	Extension    string `json:"extension"`
	Size         uint64 `json:"size"`
	DateModified int64  `json:"dateModified"`
	IsFile       bool   `json:"isFile"`
	IsFolder     bool   `json:"isFolder"`
	Attributes   uint32 `json:"attributes"`
}

type Health struct {
	OK              bool   `json:"ok"`
	Platform        string `json:"platform"`
	Architecture    string `json:"architecture"`
	GoVersion       string `json:"goVersion"`
	BuildStamp      string `json:"buildStamp"`
	DLLPath         string `json:"dllPath"`
	DLLExists       bool   `json:"dllExists"`
	DLLLoaded       bool   `json:"dllLoaded"`
	IPCReady        bool   `json:"ipcReady"`
	EverythingError string `json:"everythingError,omitempty"`
	Error           string `json:"error,omitempty"`
	CheckedAt       int64  `json:"checkedAt"`
}

const (
	RequestFileName        uint32 = 0x00000001
	RequestPath            uint32 = 0x00000002
	RequestFullPath        uint32 = 0x00000004
	RequestExtension       uint32 = 0x00000008
	RequestSize            uint32 = 0x00000010
	RequestDateModified    uint32 = 0x00000040
	RequestAttributes      uint32 = 0x00000100
	defaultFullPathBufSize        = 32768
)

const (
	ErrorOK               uint32 = 0
	ErrorMemory           uint32 = 1
	ErrorIPC              uint32 = 2
	ErrorRegisterClassEx  uint32 = 3
	ErrorCreateWindow     uint32 = 4
	ErrorCreateThread     uint32 = 5
	ErrorInvalidIndex     uint32 = 6
	ErrorInvalidCall      uint32 = 7
	ErrorInvalidRequest   uint32 = 8
	ErrorInvalidParameter uint32 = 9
)

func fileTimeToUnixMillis(low uint32, high uint32) int64 {
	const windowsToUnix100ns = 116444736000000000
	value := (uint64(high) << 32) | uint64(low)
	if value <= windowsToUnix100ns {
		return 0
	}
	return int64((value - windowsToUnix100ns) / 10000)
}

func nowMillis() int64 {
	return time.Now().UnixMilli()
}
