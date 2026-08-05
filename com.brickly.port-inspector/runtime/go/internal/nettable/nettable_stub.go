//go:build !windows && !darwin

package nettable

func listPlatform() ([]Row, string, error) {
	return nil, "", ErrUnsupported
}

func platformName() string {
	return "unsupported"
}
