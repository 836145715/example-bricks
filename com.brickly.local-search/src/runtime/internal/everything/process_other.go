//go:build !windows

package everything

func FindBundledProcess(string) (string, bool) {
	return "", false
}
