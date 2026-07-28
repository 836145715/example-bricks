//go:build !windows

package winlock

func probeProcessRefs(path string) ([]Holder, error) {
	return nil, nil
}
