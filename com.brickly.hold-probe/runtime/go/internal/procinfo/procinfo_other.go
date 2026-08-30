//go:build !windows && !darwin

package procinfo

func GetDetails(pid uint32, startKey string) (Details, error) {
	return Details{}, ErrUnsupported
}

func Stop(pid uint32, startKey string, force bool) (StopResult, error) {
	return StopResult{}, ErrUnsupported
}
