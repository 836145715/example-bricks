package winlock

import (
	"fmt"
	"time"
)

func runWithTimeout[T any](limit time.Duration, fn func() (T, error)) (T, error) {
	type outcome struct {
		value T
		err   error
	}
	ch := make(chan outcome, 1)
	go func() {
		// Never let a panic inside a stage kill the whole runtime process.
		defer func() {
			if recovered := recover(); recovered != nil {
				var zero T
				ch <- outcome{zero, fmt.Errorf("%w: panic: %v", ErrProbe, recovered)}
			}
		}()
		v, err := fn()
		ch <- outcome{v, err}
	}()

	timer := time.NewTimer(limit)
	defer timer.Stop()

	select {
	case out := <-ch:
		return out.value, out.err
	case <-timer.C:
		var zero T
		return zero, fmt.Errorf("%w: timed out after %s", ErrProbe, limit)
	}
}
