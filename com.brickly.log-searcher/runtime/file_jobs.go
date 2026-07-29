package main

import (
	"context"
	"sync"
)

const maxConcurrentFileSearches = 6

func runFileJobs(ctx context.Context, files []string, run func(filePath string) error) error {
	return runJobs(ctx, files, run)
}

func runJobs[T any](ctx context.Context, jobsToRun []T, run func(job T) error) error {
	if len(jobsToRun) == 0 {
		return nil
	}

	workerCount := maxConcurrentFileSearches
	if len(jobsToRun) < workerCount {
		workerCount = len(jobsToRun)
	}
	workCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	jobs := make(chan T)
	var workers sync.WaitGroup
	var errors sync.Mutex
	var firstError error
	fail := func(err error) {
		if err == nil {
			return
		}
		errors.Lock()
		if firstError == nil {
			firstError = err
			cancel()
		}
		errors.Unlock()
	}

	for worker := 0; worker < workerCount; worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for {
				select {
				case <-workCtx.Done():
					return
				case job, ok := <-jobs:
					if !ok {
						return
					}
					if err := run(job); err != nil {
						fail(err)
						return
					}
				}
			}
		}()
	}

sendLoop:
	for _, job := range jobsToRun {
		select {
		case <-workCtx.Done():
			break sendLoop
		case jobs <- job:
		}
	}
	close(jobs)
	workers.Wait()

	errors.Lock()
	err := firstError
	errors.Unlock()
	if err != nil {
		return err
	}
	return ctx.Err()
}
