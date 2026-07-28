//go:build !windows

package winlock

func Probe(path string, kind string, deep bool) (Result, error) {
	return Result{}, ErrUnsupported
}
