//go:build darwin
// +build darwin

package clipboard

import (
	"golang.design/x/clipboard"
)


func init() {
	clipboard.Init()
}
func ClipboardWriteAll(value string) error {
	clipboard.Write(clipboard.FmtText, []byte(value))
	return nil
}
func ClipboardReadAll() string {
	defer func() {
		if err := recover(); err != nil {
			panic(err)
		}
	}()
	t := clipboard.Read(clipboard.FmtText)
	return string(t)
}
