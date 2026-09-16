//go:build !darwin

package walker

import "errors"

var errBulkUnsupported = errors.New("getattrlistbulk unavailable on this platform")

func bulkAttrList() *struct{} { return nil }

func bulkRead(fd int, attrList *struct{}, buf []byte) (int, error) {
	return 0, errBulkUnsupported
}

func rootFSID(path string) (uint64, error) { return 0, errBulkUnsupported }
