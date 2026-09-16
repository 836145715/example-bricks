package main

import (
	"time"
)

const (
	progressMinInterval = 100 * time.Millisecond
	progressMinBytes    = 256 * 1024
)

type transferProgress struct {
	Phase          string `json:"phase"`
	Bytes          int64  `json:"bytes"`
	TotalBytes     int64  `json:"totalBytes,omitempty"`
	Percent        *int   `json:"percent,omitempty"`
	CurrentPath    string `json:"currentPath,omitempty"`
	RemotePath     string `json:"remotePath,omitempty"`
	FileIndex      int    `json:"fileIndex,omitempty"`
	FileCount      int    `json:"fileCount,omitempty"`
	FileBytes      int64  `json:"fileBytes"`
	FileTotalBytes int64  `json:"fileTotalBytes,omitempty"`
}

type progressEmitter struct {
	emit      func(transferProgress)
	phase     string
	bytes     int64
	total     int64
	current   string
	remote    string
	fileIndex int
	fileCount int
	fileBytes int64
	fileTotal int64
	lastAt    time.Time
	lastBytes int64
}

func newProgressEmitter(emit func(transferProgress)) *progressEmitter {
	return &progressEmitter{emit: emit}
}

func (p *progressEmitter) snapshot() transferProgress {
	out := transferProgress{
		Phase:          p.phase,
		Bytes:          p.bytes,
		TotalBytes:     p.total,
		CurrentPath:    p.current,
		RemotePath:     p.remote,
		FileIndex:      p.fileIndex,
		FileCount:      p.fileCount,
		FileBytes:      p.fileBytes,
		FileTotalBytes: p.fileTotal,
	}
	if p.total > 0 {
		percent := int(p.bytes * 100 / p.total)
		if percent > 100 {
			percent = 100
		}
		if p.bytes >= p.total {
			percent = 100
		}
		out.Percent = &percent
	}
	return out
}

func (p *progressEmitter) send(force bool) {
	if p.emit == nil {
		return
	}
	now := time.Now()
	if !force && !p.lastAt.IsZero() {
		if now.Sub(p.lastAt) < progressMinInterval && p.bytes-p.lastBytes < progressMinBytes {
			return
		}
	}
	p.lastAt = now
	p.lastBytes = p.bytes
	p.emit(p.snapshot())
}

func (p *progressEmitter) setPhase(phase string, force bool) {
	p.phase = phase
	p.send(force)
}

func (p *progressEmitter) setTotals(total int64, fileCount int) {
	p.total = total
	p.fileCount = fileCount
}

func (p *progressEmitter) startFile(localPath, remotePath string, index int, size int64) {
	p.current = localPath
	p.remote = remotePath
	p.fileIndex = index
	p.fileBytes = 0
	p.fileTotal = size
	p.send(true)
}

func (p *progressEmitter) addBytes(n int) {
	if n <= 0 {
		return
	}
	p.bytes += int64(n)
	p.fileBytes += int64(n)
	p.send(false)
}

func (p *progressEmitter) finishFile() {
	if p.fileTotal > 0 {
		p.fileBytes = p.fileTotal
	}
	p.send(true)
}

func (p *progressEmitter) finish() {
	if p.total > 0 {
		p.bytes = p.total
	}
	p.fileBytes = p.fileTotal
	p.send(true)
}
