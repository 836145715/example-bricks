//go:build !windows

package everything

import "errors"

func StartBundled() error {
	return errors.New(ReasonMessage(ReasonUnsupported))
}

func ExitBundled() error {
	return errors.New(ReasonMessage(ReasonUnsupported))
}
