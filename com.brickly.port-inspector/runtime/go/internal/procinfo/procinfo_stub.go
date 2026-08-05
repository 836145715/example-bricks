//go:build !windows && !darwin

package procinfo

func PlatformName() string { return "unsupported" }

func SnapshotOf(pid uint32) Snapshot {
	return Snapshot{}
}

func GetDetails(pid uint32) (Details, error) {
	return Details{}, ErrUnsupported
}

func Stop(pid uint32, force bool) (StopResult, error) {
	return StopResult{}, ErrUnsupported
}
