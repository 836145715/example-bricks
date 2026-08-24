package main

import (
	"bufio"
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"golang.org/x/crypto/ssh"
)

const (
	browseEntryDir    = "dir"
	browseEntryFile   = "file"
	maxBrowseEntries  = 400
	browseLineCWD     = "CWD"
	browseLineParent  = "PARENT"
	browseLineEntry   = "ENT"
	browseLineTrunc   = "TRUNC"
	browseLineError   = "ERR"
	browseErrNotFound = "not-found"
	browseErrNotDir   = "not-directory"
	browseErrResolve  = "resolve-failed"
)

// RemoteBrowseEntry 远程目录中的一项文件或子目录。
type RemoteBrowseEntry struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	Kind       string `json:"kind"`
	SizeBytes  int64  `json:"sizeBytes,omitempty"`
	ModifiedAt int64  `json:"modifiedAt,omitempty"`
	Searchable bool   `json:"searchable,omitempty"`
}

// RemoteBrowseResult 远程目录浏览结果。path 是当前目录；pattern 仅在通配符预览时返回。
type RemoteBrowseResult struct {
	Path      string              `json:"path"`
	Parent    string              `json:"parent,omitempty"`
	Pattern   string              `json:"pattern,omitempty"`
	Entries   []RemoteBrowseEntry `json:"entries"`
	Truncated bool                `json:"truncated,omitempty"`
}

func browsePathHasGlob(path string) bool {
	return strings.ContainsAny(path, "*?[]")
}

func parentRemotePath(path string) string {
	normalized := strings.TrimSpace(strings.ReplaceAll(path, "\\", "/"))
	normalized = strings.TrimRight(normalized, "/")
	if normalized == "" || normalized == "/" {
		return ""
	}
	index := strings.LastIndex(normalized, "/")
	if index < 0 {
		return ""
	}
	if index == 0 {
		return "/"
	}
	return normalized[:index]
}

func buildRemoteBrowseCommand(path string) string {
	return "sh -c " + shellQuote(buildRemoteBrowseScript(path))
}

func buildRemoteBrowseScript(path string) string {
	return fmt.Sprintf(`path=%s
case $path in
  "") if [ -d /var/log ]; then path=/var/log; else path=$HOME; fi ;;
  "~") path=$HOME ;;
  "~/"*) path=$HOME/${path#~/} ;;
esac
if [ ! -e "$path" ]; then
  printf 'ERR\t%s\n'
  exit 1
fi
if [ -f "$path" ]; then
  path=$(dirname -- "$path")
fi
if [ ! -d "$path" ]; then
  printf 'ERR\t%s\n'
  exit 1
fi
path=$(cd -- "$path" && pwd) || { printf 'ERR\t%s\n'; exit 1; }
parent=$(dirname -- "$path")
printf 'CWD\t%%s\n' "$path"
printf 'PARENT\t%%s\n' "$parent"
count=0
for f in "$path"/*; do
  [ -e "$f" ] || continue
  name=$(basename -- "$f")
  if [ -d "$f" ]; then
    kind=dir
  elif [ -f "$f" ]; then
    kind=file
  else
    continue
  fi
  meta=$(stat -c '%%s %%Y' -- "$f" 2>/dev/null || stat -f '%%z %%m' -- "$f" 2>/dev/null) || continue
  size=${meta%% *}
  modified_at=${meta#* }
  printf 'ENT\t%%s\t%%s\t%%s\t%%s\t%%s\n' "$kind" "$size" "$modified_at" "$name" "$f"
  count=$((count+1))
  if [ "$count" -ge %d ]; then
    printf 'TRUNC\t1\n'
    break
  fi
done
`, shellQuote(path), browseErrNotFound, browseErrNotDir, browseErrResolve, maxBrowseEntries)
}

func parseRemoteBrowseOutput(lines []string) (RemoteBrowseResult, error) {
	result := RemoteBrowseResult{Entries: []RemoteBrowseEntry{}}
	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		kind, rest, ok := strings.Cut(line, "\t")
		if !ok {
			continue
		}
		switch kind {
		case browseLineError:
			return RemoteBrowseResult{}, browseOutputError(rest)
		case browseLineCWD:
			result.Path = rest
			if result.Parent == "" {
				result.Parent = parentRemotePath(rest)
			}
		case browseLineParent:
			result.Parent = rest
		case browseLineTrunc:
			result.Truncated = rest == "1" || rest == "true"
		case browseLineEntry:
			if entry, parsed := parseRemoteBrowseEntry(rest); parsed {
				result.Entries = append(result.Entries, entry)
			}
		}
	}
	if result.Path == "" {
		return RemoteBrowseResult{}, fmt.Errorf("远程目录解析失败")
	}
	sortRemoteBrowseEntries(result.Entries)
	return result, nil
}

func browseOutputError(code string) error {
	switch strings.TrimSpace(code) {
	case browseErrNotFound:
		return fmt.Errorf("远程路径不存在")
	case browseErrNotDir:
		return fmt.Errorf("远程路径不是目录")
	case browseErrResolve:
		return fmt.Errorf("无法解析远程目录")
	default:
		if strings.TrimSpace(code) == "" {
			return fmt.Errorf("远程目录浏览失败")
		}
		return fmt.Errorf("远程目录浏览失败: %s", code)
	}
}

func parseRemoteBrowseEntry(rest string) (RemoteBrowseEntry, bool) {
	parts := strings.SplitN(rest, "\t", 5)
	if len(parts) != 5 {
		return RemoteBrowseEntry{}, false
	}
	kind := strings.TrimSpace(parts[0])
	if kind != browseEntryDir && kind != browseEntryFile {
		return RemoteBrowseEntry{}, false
	}
	sizeBytes, err := strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 64)
	if err != nil || sizeBytes < 0 {
		return RemoteBrowseEntry{}, false
	}
	modifiedAt, err := strconv.ParseInt(strings.TrimSpace(parts[2]), 10, 64)
	if err != nil || modifiedAt < 0 {
		return RemoteBrowseEntry{}, false
	}
	name := parts[3]
	path := parts[4]
	if name == "" || path == "" {
		return RemoteBrowseEntry{}, false
	}
	entry := RemoteBrowseEntry{
		Name:       name,
		Path:       path,
		Kind:       kind,
		SizeBytes:  sizeBytes,
		ModifiedAt: modifiedAt,
	}
	if kind == browseEntryFile {
		entry.Searchable = isSearchableRemoteLogMimeType(guessRemoteLogMimeType(path))
	}
	return entry, true
}

func sortRemoteBrowseEntries(entries []RemoteBrowseEntry) {
	sort.SliceStable(entries, func(i, j int) bool {
		if entries[i].Kind != entries[j].Kind {
			return entries[i].Kind == browseEntryDir
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
}

func entryFromRemoteLogFile(file RemoteLogFile) RemoteBrowseEntry {
	name := remoteFileBaseName(file.Path)
	if name == "" {
		name = file.Path
	}
	return RemoteBrowseEntry{
		Name:       name,
		Path:       file.Path,
		Kind:       browseEntryFile,
		SizeBytes:  file.SizeBytes,
		ModifiedAt: file.ModifiedAt,
		Searchable: isSearchableRemoteLogMimeType(file.MimeType) || file.MimeType == "",
	}
}

func browseRemoteGlob(ctx context.Context, client *ssh.Client, pattern string) (RemoteBrowseResult, error) {
	files, err := expandRemotePath(ctx, client, pattern)
	if err != nil {
		return RemoteBrowseResult{}, err
	}
	entries := make([]RemoteBrowseEntry, 0, len(files))
	if len(files) > 0 {
		infos, infoErr := ReadRemoteLogFileInfo(client, files)
		if infoErr != nil {
			for _, filePath := range files {
				entries = append(entries, entryFromRemoteLogFile(RemoteLogFile{Path: filePath}))
			}
		} else {
			for _, file := range infos {
				entries = append(entries, entryFromRemoteLogFile(file))
			}
		}
	}
	sortRemoteBrowseEntries(entries)
	return RemoteBrowseResult{
		Path:     parentRemotePath(pattern),
		Parent:   parentRemotePath(parentRemotePath(pattern)),
		Pattern:  pattern,
		Entries:  entries,
		Truncated: false,
	}, nil
}

func browseRemoteDirectory(ctx context.Context, client *ssh.Client, path string) (RemoteBrowseResult, error) {
	session, err := client.NewSession()
	if err != nil {
		return RemoteBrowseResult{}, fmt.Errorf("failed to create session for directory browse: %w", err)
	}
	defer session.Close()

	stdoutPipe, err := session.StdoutPipe()
	if err != nil {
		return RemoteBrowseResult{}, err
	}
	if err := session.Start(buildRemoteBrowseCommand(path)); err != nil {
		return RemoteBrowseResult{}, err
	}

	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			_ = session.Close()
		case <-done:
		}
	}()

	var lines []string
	scanner := bufio.NewScanner(stdoutPipe)
	for scanner.Scan() {
		if err := ctx.Err(); err != nil {
			return RemoteBrowseResult{}, err
		}
		lines = append(lines, scanner.Text())
	}
	if err := scanner.Err(); err != nil {
		if ctx.Err() != nil {
			return RemoteBrowseResult{}, ctx.Err()
		}
		return RemoteBrowseResult{}, err
	}
	if err := session.Wait(); err != nil {
		if ctx.Err() != nil {
			return RemoteBrowseResult{}, ctx.Err()
		}
		if result, parseErr := parseRemoteBrowseOutput(lines); parseErr == nil {
			return result, nil
		} else if parseErr.Error() != "远程目录解析失败" {
			return RemoteBrowseResult{}, parseErr
		}
		return RemoteBrowseResult{}, err
	}
	return parseRemoteBrowseOutput(lines)
}

// BrowseRemotePath 列出远程目录，或预览通配符匹配到的文件。
func BrowseRemotePath(ctx context.Context, client *ssh.Client, path string) (RemoteBrowseResult, error) {
	trimmed := strings.TrimSpace(path)
	if browsePathHasGlob(trimmed) {
		return browseRemoteGlob(ctx, client, trimmed)
	}
	return browseRemoteDirectory(ctx, client, trimmed)
}
