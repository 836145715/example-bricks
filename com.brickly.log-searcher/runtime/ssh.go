// 使用 golang.org/x/crypto/ssh 建立连接，并管理远程文件属性探测与路径展开
package main

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

// 执行远程 SSH grep（薄包装层）
func RunRemoteGrep(ctx context.Context, server ServerConfig, pattern string, files []string, args GrepArgs, onLine grepLineHandler) error {
	return RunRemoteGrepWithFiles(ctx, server, pattern, files, args, nil, onLine)
}

func RunRemoteGrepWithFiles(ctx context.Context, server ServerConfig, pattern string, files []string, args GrepArgs, onFiles func(files []string), onLine grepLineHandler) error {
	return runRemoteGrepWithFileLifecycle(ctx, server, pattern, files, args, onFiles, nil, nil, onLine)
}

// 建立 SSH Client 连接
func dialSSHClient(server ServerConfig) (*ssh.Client, error) {
	var auths []ssh.AuthMethod

	if server.AuthType == "key" {
		var keyBytes []byte
		var err error
		if server.KeyText != "" {
			keyBytes = []byte(server.KeyText)
		} else if server.KeyPath != "" {
			keyBytes, err = os.ReadFile(server.KeyPath)
			if err != nil {
				return nil, fmt.Errorf("failed to read private key file: %w", err)
			}
		} else {
			return nil, fmt.Errorf("private key is empty")
		}

		signer, err := ssh.ParsePrivateKey(keyBytes)
		if err != nil {
			return nil, fmt.Errorf("failed to parse private key: %w", err)
		}
		auths = append(auths, ssh.PublicKeys(signer))
	} else {
		auths = append(auths, ssh.Password(server.Password))
	}

	port := server.Port
	if port <= 0 {
		port = 22
	}

	config := &ssh.ClientConfig{
		User:            server.User,
		Auth:            auths,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         sshTCPTimeout,
	}

	addr := net.JoinHostPort(server.Host, strconv.Itoa(port))
	logInfo("连接远程服务器", map[string]any{"addr": addr, "user": server.User})

	conn, err := net.DialTimeout("tcp", addr, sshTCPTimeout)
	if err != nil {
		return nil, fmt.Errorf("ssh connection failed: %w", err)
	}
	if err := conn.SetDeadline(time.Now().Add(sshHandshakeTimeout)); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("ssh connection failed: %w", err)
	}

	clientConn, chans, reqs, err := ssh.NewClientConn(conn, addr, config)
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("ssh connection failed: %w", err)
	}
	if err := conn.SetDeadline(time.Time{}); err != nil {
		_ = clientConn.Close()
		return nil, fmt.Errorf("ssh connection failed: %w", err)
	}
	applyTCPKeepAlive(conn)
	return ssh.NewClient(clientConn, chans, reqs), nil
}

func isBenignRemoteGrepExit(status int) bool {
	return status == 1 || status == 141
}

// ExpandRemotePaths 展开路径
func ExpandRemotePaths(client *ssh.Client, paths []string) ([]string, error) {
	return expandRemotePaths(context.Background(), client, paths)
}

// RemoteLogFile 远程文件元信息
type RemoteLogFile struct {
	Path       string `json:"path"`
	SizeBytes  int64  `json:"sizeBytes"`
	ModifiedAt int64  `json:"modifiedAt"`
	MimeType   string `json:"mimeType"`
}

// ListRemoteLogFiles 展开配置路径并读取元信息
func ListRemoteLogFiles(client *ssh.Client, paths []string) ([]RemoteLogFile, error) {
	targetFiles, err := ExpandRemotePaths(client, paths)
	if err != nil {
		return nil, err
	}
	return ReadRemoteLogFileInfo(client, targetFiles)
}

// ReadRemoteLogFileInfo 单 session 批量读取远程文件的 inode 元信息
func ReadRemoteLogFileInfo(client *ssh.Client, targetFiles []string) ([]RemoteLogFile, error) {
	if len(targetFiles) == 0 {
		return []RemoteLogFile{}, nil
	}

	session, err := openSSHSession(client)
	if err != nil {
		return nil, fmt.Errorf("failed to create session for file metadata: %w", err)
	}
	defer session.Close()

	stdoutPipe, err := session.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := session.Start(buildRemoteFileInfoCommand(targetFiles)); err != nil {
		return nil, err
	}

	files := make([]RemoteLogFile, 0, len(targetFiles))
	scanner := bufio.NewScanner(stdoutPipe)
	for scanner.Scan() {
		if file, ok := parseRemoteLogFileInfoLine(scanner.Text()); ok {
			if file.MimeType == "" {
				file.MimeType = guessRemoteLogMimeType(file.Path)
			}
			files = append(files, file)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if err := session.Wait(); err != nil {
		return nil, err
	}
	return files, nil
}

func parseRemoteLogFileInfoLine(line string) (RemoteLogFile, bool) {
	parts := strings.SplitN(line, "\t", 4)
	if len(parts) != 2 && len(parts) != 4 {
		return RemoteLogFile{}, false
	}

	sizeBytes, err := strconv.ParseInt(strings.TrimSpace(parts[0]), 10, 64)
	if err != nil || sizeBytes < 0 {
		return RemoteLogFile{}, false
	}
	if len(parts) == 2 {
		if parts[1] == "" {
			return RemoteLogFile{}, false
		}
		return RemoteLogFile{Path: parts[1], SizeBytes: sizeBytes}, true
	}

	modifiedAt, err := strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 64)
	if err != nil || modifiedAt < 0 || parts[3] == "" {
		return RemoteLogFile{}, false
	}
	return RemoteLogFile{
		Path:       parts[3],
		SizeBytes:  sizeBytes,
		ModifiedAt: modifiedAt,
		MimeType:   strings.TrimSpace(parts[2]),
	}, true
}

func filterSearchableRemoteLogFiles(files []RemoteLogFile) []string {
	paths := make([]string, 0, len(files))
	for _, file := range files {
		if isSearchableRemoteLogMimeType(file.MimeType) {
			paths = append(paths, file.Path)
		}
	}
	return paths
}

func isSearchableRemoteLogMimeType(mimeType string) bool {
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))
	if mimeType == "" {
		return true
	}
	return strings.HasPrefix(mimeType, "text/") ||
		mimeType == "application/json" ||
		mimeType == "application/xml" ||
		mimeType == "application/x-ndjson" ||
		mimeType == "inode/x-empty"
}

func remoteFileBaseName(path string) string {
	normalized := strings.ReplaceAll(path, "\\", "/")
	if index := strings.LastIndex(normalized, "/"); index >= 0 {
		return normalized[index+1:]
	}
	return normalized
}

func guessRemoteLogMimeType(path string) string {
	name := strings.ToLower(remoteFileBaseName(path))
	if name == "" {
		return ""
	}

	for _, suffix := range []string{
		".gz", ".tgz", ".bz2", ".xz", ".zst", ".zip", ".jar", ".war", ".ear", ".7z", ".rar",
		".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".pdf",
		".so", ".dll", ".exe", ".bin", ".class", ".woff", ".woff2", ".ttf", ".otf",
	} {
		if strings.HasSuffix(name, suffix) {
			return "application/octet-stream"
		}
	}

	if strings.Contains(name, ".log") ||
		strings.HasSuffix(name, ".out") ||
		strings.HasSuffix(name, ".err") ||
		strings.HasSuffix(name, ".txt") {
		return "text/plain"
	}
	if strings.HasSuffix(name, ".json") || strings.HasSuffix(name, ".ndjson") {
		return "application/json"
	}
	if strings.HasSuffix(name, ".xml") {
		return "application/xml"
	}
	return ""
}

func isConcreteRemoteFilePath(path string) bool {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" || strings.ContainsAny(trimmed, "*?[]") {
		return false
	}
	return !strings.HasSuffix(trimmed, "/")
}

func expandRemotePaths(ctx context.Context, client *ssh.Client, paths []string) ([]string, error) {
	return expandRemotePathsWith(ctx, paths, func(ctx context.Context, path string) ([]string, error) {
		if isConcreteRemoteFilePath(path) {
			return []string{path}, nil
		}
		return expandRemotePath(ctx, client, path)
	})
}

type remotePathExpansion struct {
	index int
	path  string
}

func expandRemotePathsWith(
	ctx context.Context,
	paths []string,
	expand func(context.Context, string) ([]string, error),
) ([]string, error) {
	jobs := make([]remotePathExpansion, 0, len(paths))
	for _, path := range paths {
		trimmedPath := strings.TrimSpace(path)
		if trimmedPath == "" {
			continue
		}
		jobs = append(jobs, remotePathExpansion{index: len(jobs), path: trimmedPath})
	}

	expandedByPath := make([][]string, len(jobs))
	if err := runJobs(ctx, jobs, func(job remotePathExpansion) error {
		files, err := expand(ctx, job.path)
		if err != nil {
			return err
		}
		expandedByPath[job.index] = files
		return nil
	}); err != nil {
		return nil, err
	}

	var targetFiles []string
	for _, files := range expandedByPath {
		targetFiles = append(targetFiles, files...)
	}
	return targetFiles, nil
}

func expandRemotePath(ctx context.Context, client *ssh.Client, path string) ([]string, error) {
	session, err := openSSHSession(client)
	if err != nil {
		return nil, fmt.Errorf("failed to create session for path expansion: %w", err)
	}
	defer session.Close()

	stdoutPipe, err := session.StdoutPipe()
	if err != nil {
		return nil, err
	}

	if err := session.Start(buildRemoteExpandCommand(path)); err != nil {
		return nil, err
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

	targetFiles := make([]string, 0)
	scanner := bufio.NewScanner(stdoutPipe)
	for scanner.Scan() {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		fileLine := strings.TrimSpace(scanner.Text())
		if fileLine != "" && !strings.ContainsAny(fileLine, "*?[]") {
			targetFiles = append(targetFiles, fileLine)
		}
	}
	if err := scanner.Err(); err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, err
	}
	if err := session.Wait(); err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, err
	}
	return targetFiles, nil
}
