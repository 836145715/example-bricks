//go:build windows

package everything

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"syscall"
	"unsafe"
)

type lazySDK struct {
	dll *syscall.LazyDLL

	setSearchW             *syscall.LazyProc
	setSort                *syscall.LazyProc
	setRequestFlags        *syscall.LazyProc
	setOffset              *syscall.LazyProc
	setMax                 *syscall.LazyProc
	queryW                 *syscall.LazyProc
	reset                  *syscall.LazyProc
	getLastError           *syscall.LazyProc
	getTotResults          *syscall.LazyProc
	getNumResults          *syscall.LazyProc
	isFileResult           *syscall.LazyProc
	isFolderResult         *syscall.LazyProc
	getResultFileNameW     *syscall.LazyProc
	getResultPathW         *syscall.LazyProc
	getResultFullPathNameW *syscall.LazyProc
	getResultExtensionW    *syscall.LazyProc
	getResultSize          *syscall.LazyProc
	getResultDateModified  *syscall.LazyProc
	getResultAttributes    *syscall.LazyProc
	isDBLoaded             *syscall.LazyProc
	getMajorVersion        *syscall.LazyProc
}

func NewClient(dllPath string) *Client {
	return &Client{dllPath: dllPath}
}

func (c *Client) DLLPath() string {
	return c.dllPath
}

func (c *Client) Search(options SearchOptions) (SearchResult, error) {
	sdk, err := c.load()
	if err != nil {
		return SearchResult{}, err
	}

	queryPtr, err := syscall.UTF16PtrFromString(options.Query)
	if err != nil {
		return SearchResult{}, err
	}

	sdk.reset.Call()
	sdk.setSearchW.Call(uintptr(unsafe.Pointer(queryPtr)))
	sdk.setSort.Call(uintptr(options.Sort))
	sdk.setRequestFlags.Call(uintptr(
		RequestFileName |
			RequestPath |
			RequestFullPath |
			RequestExtension |
			RequestSize |
			RequestDateModified |
			RequestAttributes,
	))
	sdk.setOffset.Call(uintptr(options.Offset))
	sdk.setMax.Call(uintptr(options.Limit))

	ok, _, _ := sdk.queryW.Call(1)
	if ok == 0 {
		return SearchResult{}, sdk.lastError()
	}

	total, _, _ := sdk.getTotResults.Call()
	count, _, _ := sdk.getNumResults.Call()
	items := make([]Item, 0, count)
	for i := uintptr(0); i < count; i++ {
		item := Item{
			Name:       utf16PtrToString(callPtr(sdk.getResultFileNameW, i)),
			Path:       utf16PtrToString(callPtr(sdk.getResultPathW, i)),
			Extension:  utf16PtrToString(callPtr(sdk.getResultExtensionW, i)),
			IsFile:     callBool(sdk.isFileResult, i),
			IsFolder:   callBool(sdk.isFolderResult, i),
			Attributes: uint32(callUintptr(sdk.getResultAttributes, i)),
		}
		item.FullPath = sdk.fullPath(i)
		item.Size = sdk.size(i)
		item.DateModified = sdk.dateModified(i)
		items = append(items, item)
	}

	return SearchResult{
		Total:  uint32(total),
		Offset: options.Offset,
		Limit:  options.Limit,
		Items:  items,
	}, nil
}

func (c *Client) Health(buildStamp string) Health {
	health := Health{
		Platform:     runtime.GOOS,
		Architecture: runtime.GOARCH,
		GoVersion:    runtime.Version(),
		BuildStamp:   buildStamp,
		DLLPath:      c.dllPath,
		DLLExists:    fileExists(c.dllPath),
		CheckedAt:    nowMillis(),
	}

	sdk, err := c.load()
	if err != nil {
		health.Error = err.Error()
		return health
	}
	health.DLLLoaded = true
	if sdk.getMajorVersion != nil {
		if _, _, err := sdk.getMajorVersion.Call(); err != syscall.Errno(0) {
			health.Error = err.Error()
		}
	}
	if sdk.isDBLoaded != nil {
		ok, _, _ := sdk.isDBLoaded.Call()
		health.IPCReady = ok != 0
	}
	if !health.IPCReady {
		if sdkErr := sdk.lastError(); sdkErr != nil {
			health.EverythingError = sdkErr.Error()
		}
	}
	health.OK = health.DLLLoaded && health.IPCReady
	return health
}

func (c *Client) load() (*lazySDK, error) {
	if c == nil {
		return nil, errors.New("Everything client 未初始化")
	}
	if c.dllPath == "" {
		return nil, errors.New("Everything64.dll 路径为空")
	}
	if !fileExists(c.dllPath) {
		return nil, errors.New("Everything64.dll 不存在: " + c.dllPath)
	}
	dll := syscall.NewLazyDLL(c.dllPath)
	sdk := &lazySDK{
		dll:                    dll,
		setSearchW:             dll.NewProc("Everything_SetSearchW"),
		setSort:                dll.NewProc("Everything_SetSort"),
		setRequestFlags:        dll.NewProc("Everything_SetRequestFlags"),
		setOffset:              dll.NewProc("Everything_SetOffset"),
		setMax:                 dll.NewProc("Everything_SetMax"),
		queryW:                 dll.NewProc("Everything_QueryW"),
		reset:                  dll.NewProc("Everything_Reset"),
		getLastError:           dll.NewProc("Everything_GetLastError"),
		getTotResults:          dll.NewProc("Everything_GetTotResults"),
		getNumResults:          dll.NewProc("Everything_GetNumResults"),
		isFileResult:           dll.NewProc("Everything_IsFileResult"),
		isFolderResult:         dll.NewProc("Everything_IsFolderResult"),
		getResultFileNameW:     dll.NewProc("Everything_GetResultFileNameW"),
		getResultPathW:         dll.NewProc("Everything_GetResultPathW"),
		getResultFullPathNameW: dll.NewProc("Everything_GetResultFullPathNameW"),
		getResultExtensionW:    dll.NewProc("Everything_GetResultExtensionW"),
		getResultSize:          dll.NewProc("Everything_GetResultSize"),
		getResultDateModified:  dll.NewProc("Everything_GetResultDateModified"),
		getResultAttributes:    dll.NewProc("Everything_GetResultAttributes"),
		isDBLoaded:             dll.NewProc("Everything_IsDBLoaded"),
		getMajorVersion:        dll.NewProc("Everything_GetMajorVersion"),
	}
	if err := dll.Load(); err != nil {
		return nil, err
	}
	for name, proc := range map[string]*syscall.LazyProc{
		"Everything_SetSearchW":             sdk.setSearchW,
		"Everything_SetSort":                sdk.setSort,
		"Everything_SetRequestFlags":        sdk.setRequestFlags,
		"Everything_SetOffset":              sdk.setOffset,
		"Everything_SetMax":                 sdk.setMax,
		"Everything_QueryW":                 sdk.queryW,
		"Everything_Reset":                  sdk.reset,
		"Everything_GetLastError":           sdk.getLastError,
		"Everything_GetTotResults":          sdk.getTotResults,
		"Everything_GetNumResults":          sdk.getNumResults,
		"Everything_IsFileResult":           sdk.isFileResult,
		"Everything_IsFolderResult":         sdk.isFolderResult,
		"Everything_GetResultFileNameW":     sdk.getResultFileNameW,
		"Everything_GetResultPathW":         sdk.getResultPathW,
		"Everything_GetResultFullPathNameW": sdk.getResultFullPathNameW,
		"Everything_GetResultExtensionW":    sdk.getResultExtensionW,
		"Everything_GetResultSize":          sdk.getResultSize,
		"Everything_GetResultDateModified":  sdk.getResultDateModified,
		"Everything_GetResultAttributes":    sdk.getResultAttributes,
	} {
		if err := proc.Find(); err != nil {
			return nil, errors.New("Everything SDK 缺少导出函数: " + name)
		}
	}
	return sdk, nil
}

func (sdk *lazySDK) lastError() error {
	code, _, _ := sdk.getLastError.Call()
	return &SDKError{Code: uint32(code), Text: errorText(uint32(code))}
}

func (sdk *lazySDK) fullPath(index uintptr) string {
	buffer := make([]uint16, defaultFullPathBufSize)
	n, _, _ := sdk.getResultFullPathNameW.Call(
		index,
		uintptr(unsafe.Pointer(&buffer[0])),
		uintptr(len(buffer)),
	)
	if n == 0 {
		return ""
	}
	if int(n) >= len(buffer) {
		return syscall.UTF16ToString(buffer)
	}
	return syscall.UTF16ToString(buffer[:n])
}

func (sdk *lazySDK) size(index uintptr) uint64 {
	var value int64
	ok, _, _ := sdk.getResultSize.Call(index, uintptr(unsafe.Pointer(&value)))
	if ok == 0 || value < 0 {
		return 0
	}
	return uint64(value)
}

func (sdk *lazySDK) dateModified(index uintptr) int64 {
	var ft struct {
		Low  uint32
		High uint32
	}
	ok, _, _ := sdk.getResultDateModified.Call(index, uintptr(unsafe.Pointer(&ft)))
	if ok == 0 {
		return 0
	}
	return fileTimeToUnixMillis(ft.Low, ft.High)
}

func callPtr(proc *syscall.LazyProc, args ...uintptr) uintptr {
	value, _, _ := proc.Call(args...)
	return value
}

func callUintptr(proc *syscall.LazyProc, args ...uintptr) uintptr {
	value, _, _ := proc.Call(args...)
	return value
}

func callBool(proc *syscall.LazyProc, args ...uintptr) bool {
	value, _, _ := proc.Call(args...)
	return value != 0
}

func utf16PtrToString(ptr uintptr) string {
	if ptr == 0 {
		return ""
	}
	chars := make([]uint16, 0, 260)
	for offset := uintptr(0); ; offset += unsafe.Sizeof(uint16(0)) {
		char := *(*uint16)(unsafe.Pointer(ptr + offset))
		if char == 0 {
			break
		}
		chars = append(chars, char)
	}
	return syscall.UTF16ToString(chars)
}

func fileExists(path string) bool {
	if path == "" {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func DefaultDLLPath() string {
	exe, err := os.Executable()
	if err != nil {
		return filepath.Clean("vendor/win-x64/Everything64.dll")
	}
	brickRoot := filepath.Clean(filepath.Join(filepath.Dir(exe), "..", ".."))
	return filepath.Join(brickRoot, "vendor", "win-x64", "Everything64.dll")
}
