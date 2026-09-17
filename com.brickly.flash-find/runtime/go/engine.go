// 引擎包装：cgo 边界。所有 C 调用都在这里，main.go 只见 Go 类型。
package main

/*
#cgo CFLAGS: -I${SRCDIR}/core/ffbridge
#cgo LDFLAGS: ${SRCDIR}/build/current/libffcore.a ${SRCDIR}/build/current/libre2.a -lc++ -framework CoreServices -framework Foundation
#include <stdlib.h>
#include "ff_bridge.h"
*/
import "C"

import (
	"fmt"
	"unsafe"
)

// Engine 持有 ff_engine。生命周期与 owned Go 进程一致：
// 进程退出即回收，不做 ff_free（引擎析构会再走一遍 shutdown，存在竞态，没必要冒险）。
type Engine struct {
	ptr *C.ff_engine
}

// NewEngine 创建引擎。scanRoot 用 "/"（对齐 Everything 的全盘语义）。
func NewEngine(scanRoot, cacheDir, logDir string) (*Engine, error) {
	cRoot := C.CString(scanRoot)
	cCache := C.CString(cacheDir)
	cLog := C.CString(logDir)
	defer func() {
		C.free(unsafe.Pointer(cRoot))
		C.free(unsafe.Pointer(cCache))
		C.free(unsafe.Pointer(cLog))
	}()
	ptr := C.ff_new(cRoot, cCache, cLog)
	if ptr == nil {
		return nil, fmt.Errorf("ff_new failed (scanRoot=%s cacheDir=%s)", scanRoot, cacheDir)
	}
	return &Engine{ptr: ptr}, nil
}

// Start 增量启动：命中磁盘缓存秒级返回，否则后台全量扫描。异步，进度走 Status。
func (e *Engine) Start() error {
	if C.ff_start(e.ptr) != 0 {
		return fmt.Errorf("ff_start failed")
	}
	return nil
}

// Rebuild 全量重建。异步。
func (e *Engine) Rebuild() error {
	if C.ff_rebuild(e.ptr) != 0 {
		return fmt.Errorf("ff_rebuild failed")
	}
	return nil
}

// Search 返回原始 JSON（引擎语法透传：ext: size: path: regex: 等）。
func (e *Engine) Search(query string, limit int) (string, error) {
	cq := C.CString(query)
	defer C.free(unsafe.Pointer(cq))
	res := C.ff_search(e.ptr, cq, C.int(limit))
	if res == nil {
		return "", fmt.Errorf("ff_search returned nil")
	}
	defer C.ff_free_string(res)
	return C.GoString(res), nil
}

// Recent 返回最近修改文件的原始 JSON。
func (e *Engine) Recent(count int) (string, error) {
	res := C.ff_recent(e.ptr, C.int(count))
	if res == nil {
		return "", fmt.Errorf("ff_recent returned nil")
	}
	defer C.ff_free_string(res)
	return C.GoString(res), nil
}

// Status 返回引擎状态原始 JSON。
func (e *Engine) Status() (string, error) {
	res := C.ff_status(e.ptr)
	if res == nil {
		return "", fmt.Errorf("ff_status returned nil")
	}
	defer C.ff_free_string(res)
	return C.GoString(res), nil
}
