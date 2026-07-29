package main

import (
	"context"
	"path/filepath"
	"sync"
	"testing"
)

func TestRunFileJobsSearchesMultipleFilesConcurrentlyWithinLimit(t *testing.T) {
	files := make([]string, maxConcurrentFileSearches*2)
	for index := range files {
		files[index] = filepath.Join("logs", string(rune('a'+index)))
	}

	started := make(chan struct{}, maxConcurrentFileSearches)
	release := make(chan struct{})
	var mu sync.Mutex
	active := 0
	peak := 0

	done := make(chan error, 1)
	go func() {
		done <- runFileJobs(context.Background(), files, func(_ string) error {
			mu.Lock()
			active++
			if active > peak {
				peak = active
			}
			mu.Unlock()

			started <- struct{}{}
			<-release

			mu.Lock()
			active--
			mu.Unlock()
			return nil
		})
	}()

	for index := 0; index < maxConcurrentFileSearches; index++ {
		<-started
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatalf("runFileJobs() error = %v", err)
	}

	if peak != maxConcurrentFileSearches {
		t.Fatalf("peak concurrent files = %d, want %d", peak, maxConcurrentFileSearches)
	}
}
