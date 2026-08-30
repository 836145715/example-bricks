//go:build windows

package pathnorm

import (
	"errors"

	"golang.org/x/sys/windows"
)

func isInvalidPath(err error) bool {
	var errno windows.Errno
	if errors.As(err, &errno) {
		return errno == windows.ERROR_INVALID_NAME || errno == windows.ERROR_BAD_PATHNAME
	}
	return false
}
