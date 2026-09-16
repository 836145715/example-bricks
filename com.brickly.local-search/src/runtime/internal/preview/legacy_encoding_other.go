//go:build !windows

package preview

func decodeLegacyArchiveName(_ []byte) (string, bool) {
	return "", false
}
