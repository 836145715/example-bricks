//go:build !windows

package pathnorm

func isInvalidPath(err error) bool {
	return false
}
