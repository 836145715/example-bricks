package main

import (
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/pkg/sftp"
)

type remoteInfo struct {
	Name  string
	Path  string
	Dir   bool
	Size  int64
	Mtime time.Time
	Mode  string
	Link  bool
}

type remoteFS interface {
	Home() (string, error)
	Resolve(raw string) (string, error)
	Stat(path string) (remoteInfo, error)
	ReadDir(path string) ([]remoteInfo, error)
	Open(path string) (io.ReadCloser, error)
	Create(path string, overwrite bool) (io.WriteCloser, error)
	MkdirAll(path string) error
}

type sftpRemote struct {
	client *sftp.Client
}

func (r *sftpRemote) Home() (string, error) {
	wd, err := r.client.Getwd()
	if err != nil {
		return "", newSFTPError(err.Error())
	}
	cleaned := strings.ReplaceAll(wd, "\\", "/")
	if cleaned == "" {
		cleaned = "/"
	}
	return cleaned, nil
}

func (r *sftpRemote) Resolve(raw string) (string, error) {
	normalized, err := normalizeRemotePath(raw)
	if err != nil {
		return "", err
	}
	if normalized == "" || normalized == "~" {
		return r.Home()
	}
	if strings.HasPrefix(normalized, "~/") {
		home, err := r.Home()
		if err != nil {
			return "", err
		}
		return joinRemote(home, strings.TrimPrefix(normalized, "~/")), nil
	}
	if strings.HasPrefix(normalized, "/") {
		return path.Clean(normalized), nil
	}
	home, err := r.Home()
	if err != nil {
		return "", err
	}
	return joinRemote(home, normalized), nil
}

func (r *sftpRemote) Stat(remotePath string) (remoteInfo, error) {
	info, err := r.client.Lstat(remotePath)
	if err != nil {
		if os.IsNotExist(err) {
			return remoteInfo{}, fs.ErrNotExist
		}
		return remoteInfo{}, newSFTPError(err.Error())
	}
	return infoFromFile(remotePath, info), nil
}

func (r *sftpRemote) ReadDir(remotePath string) ([]remoteInfo, error) {
	entries, err := r.client.ReadDir(remotePath)
	if err != nil {
		return nil, newSFTPError(err.Error())
	}
	out := make([]remoteInfo, 0, len(entries))
	for _, entry := range entries {
		out = append(out, infoFromFile(joinRemote(remotePath, entry.Name()), entry))
	}
	return out, nil
}

func (r *sftpRemote) Open(remotePath string) (io.ReadCloser, error) {
	file, err := r.client.Open(remotePath)
	if err != nil {
		return nil, newSFTPError(err.Error())
	}
	return file, nil
}

func (r *sftpRemote) Create(remotePath string, overwrite bool) (io.WriteCloser, error) {
	flags := os.O_WRONLY | os.O_CREATE | os.O_EXCL
	if overwrite {
		flags = os.O_WRONLY | os.O_CREATE | os.O_TRUNC
	}
	file, err := r.client.OpenFile(remotePath, flags)
	if err != nil {
		if os.IsExist(err) {
			return nil, newExistsError(remotePath)
		}
		return nil, newSFTPError(err.Error())
	}
	return file, nil
}

func (r *sftpRemote) MkdirAll(remotePath string) error {
	if err := r.client.MkdirAll(remotePath); err != nil {
		return newSFTPError(err.Error())
	}
	return nil
}

func infoFromFile(remotePath string, info os.FileInfo) remoteInfo {
	mode := info.Mode()
	kindDir := info.IsDir()
	if mode&os.ModeSymlink != 0 && !kindDir {
		// Keep list usable even if the target cannot be followed.
		kindDir = false
	}
	return remoteInfo{
		Name:  info.Name(),
		Path:  remotePath,
		Dir:   kindDir,
		Size:  info.Size(),
		Mtime: info.ModTime(),
		Mode:  fmt.Sprintf("%04o", mode.Perm()),
		Link:  mode&os.ModeSymlink != 0,
	}
}

type mappedRemote struct {
	root string
	home string
}

func newMappedRemote(root, home string) *mappedRemote {
	if home == "" {
		home = "/"
	}
	return &mappedRemote{root: root, home: home}
}

func (m *mappedRemote) Home() (string, error) {
	return m.home, nil
}

func (m *mappedRemote) Resolve(raw string) (string, error) {
	normalized, err := normalizeRemotePath(raw)
	if err != nil {
		return "", err
	}
	if normalized == "" || normalized == "~" {
		return m.home, nil
	}
	if strings.HasPrefix(normalized, "~/") {
		return joinRemote(m.home, strings.TrimPrefix(normalized, "~/")), nil
	}
	if strings.HasPrefix(normalized, "/") {
		return path.Clean(normalized), nil
	}
	return joinRemote(m.home, normalized), nil
}

func (m *mappedRemote) toLocal(remotePath string) (string, error) {
	cleaned := path.Clean("/" + strings.TrimPrefix(remotePath, "/"))
	rel := strings.TrimPrefix(cleaned, "/")
	dest := m.root
	if rel != "" && rel != "." {
		dest = filepath.Join(m.root, filepath.FromSlash(rel))
	}
	relToRoot, err := filepath.Rel(m.root, dest)
	if err != nil || relToRoot == ".." || strings.HasPrefix(relToRoot, ".."+string(filepath.Separator)) {
		return "", newInputError("invalid remote path")
	}
	return dest, nil
}

func (m *mappedRemote) Stat(remotePath string) (remoteInfo, error) {
	local, err := m.toLocal(remotePath)
	if err != nil {
		return remoteInfo{}, err
	}
	info, err := os.Lstat(local)
	if err != nil {
		if os.IsNotExist(err) {
			return remoteInfo{}, fs.ErrNotExist
		}
		return remoteInfo{}, newSFTPError(err.Error())
	}
	return infoFromFile(remotePath, info), nil
}

func (m *mappedRemote) ReadDir(remotePath string) ([]remoteInfo, error) {
	local, err := m.toLocal(remotePath)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(local)
	if err != nil {
		return nil, newSFTPError(err.Error())
	}
	out := make([]remoteInfo, 0, len(entries))
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}
		out = append(out, infoFromFile(joinRemote(remotePath, entry.Name()), info))
	}
	return out, nil
}

func (m *mappedRemote) Open(remotePath string) (io.ReadCloser, error) {
	local, err := m.toLocal(remotePath)
	if err != nil {
		return nil, err
	}
	file, err := os.Open(local)
	if err != nil {
		return nil, newSFTPError(err.Error())
	}
	return file, nil
}

func (m *mappedRemote) Create(remotePath string, overwrite bool) (io.WriteCloser, error) {
	local, err := m.toLocal(remotePath)
	if err != nil {
		return nil, err
	}
	flags := os.O_WRONLY | os.O_CREATE | os.O_EXCL
	if overwrite {
		flags = os.O_WRONLY | os.O_CREATE | os.O_TRUNC
	}
	file, err := os.OpenFile(local, flags, 0o644)
	if err != nil {
		if os.IsExist(err) {
			return nil, newExistsError(remotePath)
		}
		return nil, newSFTPError(err.Error())
	}
	return file, nil
}

func (m *mappedRemote) MkdirAll(remotePath string) error {
	local, err := m.toLocal(remotePath)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(local, 0o755); err != nil {
		return newSFTPError(err.Error())
	}
	return nil
}
