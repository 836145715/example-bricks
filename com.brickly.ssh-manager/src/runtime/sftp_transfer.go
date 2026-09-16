package main

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const copyBufferSize = 32 * 1024

type localFile struct {
	Path   string
	Rel    string
	Size   int64
	IsDir  bool
}

type listResult struct {
	Path    string           `json:"path"`
	Entries []map[string]any `json:"entries"`
}

type transferResult struct {
	OK         bool   `json:"ok"`
	RemotePath string `json:"remotePath"`
	LocalPath  string `json:"localPath,omitempty"`
	Bytes      int64  `json:"bytes"`
}

func listRemote(fsys remoteFS, rawPath string) (listResult, error) {
	resolved, err := fsys.Resolve(rawPath)
	if err != nil {
		return listResult{}, err
	}
	entries, err := fsys.ReadDir(resolved)
	if err != nil {
		return listResult{}, err
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Dir != entries[j].Dir {
			return entries[i].Dir
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
	out := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		item := map[string]any{
			"name":    entry.Name,
			"path":    entry.Path,
			"kind":    "file",
			"size":    entry.Size,
			"mtimeMs": entry.Mtime.UnixMilli(),
			"mode":    entry.Mode,
		}
		if entry.Dir {
			item["kind"] = "dir"
		}
		if entry.Link {
			item["link"] = true
		}
		out = append(out, item)
	}
	return listResult{Path: resolved, Entries: out}, nil
}

func uploadLocal(ctx context.Context, fsys remoteFS, localPath, remoteDir string, overwrite bool, progress *progressEmitter) (transferResult, error) {
	localPath, err := requireAbsoluteLocal(localPath)
	if err != nil {
		return transferResult{}, err
	}
	info, err := os.Lstat(localPath)
	if err != nil {
		if os.IsNotExist(err) {
			return transferResult{}, newInputError("本机路径不存在")
		}
		return transferResult{}, newSFTPError(err.Error())
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return transferResult{}, newInputError("不支持上传符号链接")
	}

	if progress != nil {
		progress.setPhase("scanning", true)
	}
	items, total, err := walkLocal(localPath, info)
	if err != nil {
		return transferResult{}, err
	}
	fileCount := 0
	for _, item := range items {
		if !item.IsDir {
			fileCount++
		}
	}
	if progress != nil {
		progress.setTotals(total, maxInt(fileCount, 1))
	}

	resolvedDir, err := fsys.Resolve(remoteDir)
	if err != nil {
		return transferResult{}, err
	}
	rootRemote := joinRemote(resolvedDir, filepath.Base(localPath))
	if err := preflightUpload(fsys, items, resolvedDir, info.IsDir(), overwrite); err != nil {
		return transferResult{}, err
	}

	if progress != nil {
		progress.phase = "upload"
		progress.send(true)
	}

	fileIndex := 0
	var written int64
	for _, item := range items {
		if ctx.Err() != nil {
			return transferResult{}, newSSHError("SSH_TIMEOUT", "upload cancelled or timed out")
		}
		remotePath := joinRemote(resolvedDir, item.Rel)
		if item.IsDir {
			if err := fsys.MkdirAll(remotePath); err != nil {
				return transferResult{}, err
			}
			continue
		}
		fileIndex++
		if progress != nil {
			progress.startFile(item.Path, remotePath, fileIndex, item.Size)
		}
		n, err := copyToRemote(ctx, fsys, item.Path, remotePath, overwrite, progress)
		if err != nil {
			if progress != nil {
				progress.phase = "error"
				progress.send(true)
			}
			return transferResult{}, err
		}
		written += n
		if progress != nil {
			progress.finishFile()
		}
	}
	if progress != nil {
		progress.finish()
	}
	return transferResult{OK: true, RemotePath: rootRemote, Bytes: written}, nil
}

func downloadRemote(ctx context.Context, fsys remoteFS, remotePath, localDir string, overwrite bool, progress *progressEmitter) (transferResult, error) {
	if strings.TrimSpace(localDir) == "" {
		return transferResult{}, newInputError("localDir is required")
	}
	if !filepath.IsAbs(localDir) {
		return transferResult{}, newInputError("localDir must be an absolute path")
	}
	if err := os.MkdirAll(localDir, 0o755); err != nil {
		return transferResult{}, newSFTPError(err.Error())
	}

	resolved, err := fsys.Resolve(remotePath)
	if err != nil {
		return transferResult{}, err
	}
	info, err := fsys.Stat(resolved)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return transferResult{}, newNotFoundError("远端路径不存在")
		}
		return transferResult{}, err
	}

	if progress != nil {
		progress.setPhase("scanning", true)
	}
	items, total, err := walkRemote(fsys, info)
	if err != nil {
		return transferResult{}, err
	}
	fileCount := 0
	for _, item := range items {
		if !item.Dir {
			fileCount++
		}
	}
	if progress != nil {
		progress.setTotals(total, maxInt(fileCount, 1))
		progress.phase = "download"
		progress.send(true)
	}

	base := remoteBase(resolved)
	if base == "" {
		return transferResult{}, newInputError("invalid remote path")
	}
	rootLocal, err := confineLocal(localDir, base)
	if err != nil {
		return transferResult{}, err
	}

	fileIndex := 0
	var written int64
	for _, item := range items {
		if ctx.Err() != nil {
			return transferResult{}, newSSHError("SSH_TIMEOUT", "download cancelled or timed out")
		}
		rel := remoteRel(resolved, item.Path, info.Dir)
		dest, err := confineLocal(localDir, rel)
		if err != nil {
			return transferResult{}, err
		}
		if item.Dir {
			if err := os.MkdirAll(dest, 0o755); err != nil {
				return transferResult{}, newSFTPError(err.Error())
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return transferResult{}, newSFTPError(err.Error())
		}
		if existing, statErr := os.Lstat(dest); statErr == nil {
			if existing.IsDir() {
				return transferResult{}, newSFTPError("本机已存在同名目录")
			}
			if !overwrite {
				return transferResult{}, newExistsError(item.Path)
			}
		} else if !os.IsNotExist(statErr) {
			return transferResult{}, newSFTPError(statErr.Error())
		}
		fileIndex++
		if progress != nil {
			progress.startFile(dest, item.Path, fileIndex, item.Size)
		}
		n, err := copyToLocal(ctx, fsys, item.Path, dest, overwrite, progress)
		if err != nil {
			if progress != nil {
				progress.phase = "error"
				progress.send(true)
			}
			return transferResult{}, err
		}
		written += n
		if progress != nil {
			progress.finishFile()
		}
	}
	if progress != nil {
		progress.finish()
	}
	return transferResult{OK: true, RemotePath: resolved, LocalPath: rootLocal, Bytes: written}, nil
}

func remoteRel(root, full string, rootIsDir bool) string {
	if !rootIsDir {
		return remoteBase(root)
	}
	prefix := strings.TrimRight(root, "/")
	if full == root || full == prefix {
		return remoteBase(root)
	}
	return strings.TrimPrefix(joinRemote(remoteBase(root), strings.TrimPrefix(full, prefix+"/")), "/")
}

func walkLocal(root string, info os.FileInfo) ([]localFile, int64, error) {
	base := filepath.Base(root)
	if !info.IsDir() {
		return []localFile{{Path: root, Rel: base, Size: info.Size()}}, info.Size(), nil
	}
	var items []localFile
	var total int64
	err := filepath.Walk(root, func(path string, walkInfo os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if walkInfo.Mode()&os.ModeSymlink != 0 {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		relSlash := filepath.ToSlash(rel)
		if relSlash == "." {
			items = append(items, localFile{Path: path, Rel: base, IsDir: true})
			return nil
		}
		item := localFile{Path: path, Rel: base + "/" + relSlash, IsDir: walkInfo.IsDir(), Size: walkInfo.Size()}
		if !walkInfo.IsDir() {
			total += walkInfo.Size()
		}
		items = append(items, item)
		return nil
	})
	if err != nil {
		return nil, 0, newSFTPError(err.Error())
	}
	return items, total, nil
}

func walkRemote(fsys remoteFS, root remoteInfo) ([]remoteInfo, int64, error) {
	if !root.Dir {
		return []remoteInfo{root}, root.Size, nil
	}
	var items []remoteInfo
	var total int64
	var walk func(remoteInfo) error
	walk = func(entry remoteInfo) error {
		items = append(items, entry)
		if !entry.Dir {
			total += entry.Size
			return nil
		}
		children, err := fsys.ReadDir(entry.Path)
		if err != nil {
			return err
		}
		for _, child := range children {
			if err := walk(child); err != nil {
				return err
			}
		}
		return nil
	}
	if err := walk(root); err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func preflightUpload(fsys remoteFS, items []localFile, remoteDir string, uploadingDir bool, overwrite bool) error {
	if uploadingDir {
		root := joinRemote(remoteDir, items[0].Rel)
		existing, err := fsys.Stat(root)
		if err == nil && !existing.Dir {
			return newSFTPError("远端已存在同名文件")
		}
		if err != nil && !errors.Is(err, fs.ErrNotExist) {
			return err
		}
	}
	for _, item := range items {
		if item.IsDir {
			continue
		}
		remotePath := joinRemote(remoteDir, item.Rel)
		existing, err := fsys.Stat(remotePath)
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		if existing.Dir {
			return newSFTPError("远端已存在同名目录")
		}
		if !overwrite {
			return newExistsError(remotePath)
		}
	}
	return nil
}

func copyToRemote(ctx context.Context, fsys remoteFS, localPath, remotePath string, overwrite bool, progress *progressEmitter) (int64, error) {
	src, err := os.Open(localPath)
	if err != nil {
		return 0, newSFTPError(err.Error())
	}
	defer src.Close()
	dst, err := fsys.Create(remotePath, overwrite)
	if err != nil {
		return 0, err
	}
	defer dst.Close()
	return copyWithProgress(ctx, dst, src, progress)
}

func copyToLocal(ctx context.Context, fsys remoteFS, remotePath, localPath string, overwrite bool, progress *progressEmitter) (int64, error) {
	src, err := fsys.Open(remotePath)
	if err != nil {
		return 0, err
	}
	defer src.Close()
	flags := os.O_WRONLY | os.O_CREATE | os.O_EXCL
	if overwrite {
		flags = os.O_WRONLY | os.O_CREATE | os.O_TRUNC
	}
	dst, err := os.OpenFile(localPath, flags, 0o644)
	if err != nil {
		if os.IsExist(err) {
			return 0, newExistsError(remotePath)
		}
		return 0, newSFTPError(err.Error())
	}
	defer dst.Close()
	return copyWithProgress(ctx, dst, src, progress)
}

func copyWithProgress(ctx context.Context, dst io.Writer, src io.Reader, progress *progressEmitter) (int64, error) {
	buf := make([]byte, copyBufferSize)
	var written int64
	for {
		if ctx.Err() != nil {
			return written, newSSHError("SSH_TIMEOUT", "transfer cancelled or timed out")
		}
		n, readErr := src.Read(buf)
		if n > 0 {
			if _, err := dst.Write(buf[:n]); err != nil {
				return written, newSFTPError(err.Error())
			}
			written += int64(n)
			if progress != nil {
				progress.addBytes(n)
			}
		}
		if readErr == io.EOF {
			return written, nil
		}
		if readErr != nil {
			return written, newSFTPError(readErr.Error())
		}
	}
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
