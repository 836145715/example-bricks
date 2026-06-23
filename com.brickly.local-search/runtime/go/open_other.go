//go:build !windows

package main

import "errors"

func openLocalPath(string) error {
	return errors.New("本地搜索 Quick Search 激活仅支持 Windows")
}
