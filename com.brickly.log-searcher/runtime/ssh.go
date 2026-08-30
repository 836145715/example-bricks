// 使用 golang.org/x/crypto/ssh 成品库建立连接，并在远程 Linux 上执行 grep
package main

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

// 执行远程 SSH grep
func RunRemoteGrep(ctx context.Context, server ServerConfig, pattern string, files []string, args GrepArgs, onLine func(line GrepLine)) error {
	return RunRemoteGrepWithFiles(ctx, server, pattern, files, args, nil, onLine)
}

func RunRemoteGrepWithFiles(ctx context.Context, server ServerConfig, pattern string, files []string, args GrepArgs, onFiles func(files []string), onLine func(line GrepLine)) error {
	return runRemoteGrepWithFileLifecycle(ctx, server, pattern, files, args, onFiles, nil, nil, onLine)
}

func runRemoteGrepWithFileLifecycle(
	ctx context.Context,
	server ServerConfig,
	pattern string,
	files []string,
	args GrepArgs,
	onFiles func(files []string),
	onFileStart func(filePath string),
	onFileDone func(filePath string),
	onLine func(line GrepLine),
) error {
	client, release, err := acquireSSHClient(ctx, server)
	if err != nil {
		return err
	}
	defer release()

	targetFiles, err := expandRemotePaths(ctx, client, files)
	if err != nil {
		return err
	}
	if len(targetFiles) == 0 {
		return fmt.Errorf("no matching remote log files found")
	}
	if onFiles != nil {
		onFiles(targetFiles)
	}

	filterConfigs := buildEffectiveFilters(pattern, args)
	if len(filterConfigs) == 0 {
		return fmt.Errorf("pattern is required")
	}

	highlightFilters := make([]compiledFilter, 0, len(filterConfigs))
	for _, filterConfig := range filterConfigs {
		re, err := buildFilterRegexp(
			filterConfig.Pattern,
			filterConfig.Regexp,
			filterConfig.WordRegexp,
			filterConfig.IgnoreCase,
		)
		if err == nil {
			highlightFilters = append(highlightFilters, compiledFilter{Config: filterConfig, Re: re})
		}
	}
	highlighter := newSearchHighlighter(highlightFilters)
	parseArgs := args
	parseArgs.ShowLineNum = true
	outputParser := newRemoteGrepOutputParser(parseArgs, targetFiles)
	primaryOpts := buildRemotePrimaryOptions(parseArgs)

	// 3. 复用同一个 SSH client，逐文件创建 session。避免多文件搜索反复 SSH 握手。
	var callbacks sync.Mutex
	reportStart := func(filePath string) {
		if onFileStart == nil {
			return
		}
		callbacks.Lock()
		defer callbacks.Unlock()
		onFileStart(filePath)
	}
	reportDone := func(filePath string) {
		if onFileDone == nil {
			return
		}
		callbacks.Lock()
		defer callbacks.Unlock()
		onFileDone(filePath)
	}
	reportLine := func(line GrepLine) {
		callbacks.Lock()
		defer callbacks.Unlock()
		onLine(line)
	}

	return runFileJobs(ctx, targetFiles, func(targetFile string) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		reportStart(targetFile)

		grepErr := runRemoteGrepFile(ctx, client, targetFile, primaryOpts, filterConfigs, args, outputParser, highlightFilters, highlighter, reportLine)
		if grepErr != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			reportLine(GrepLine{
				Text:  grepErr.Error(),
				File:  targetFile,
				Error: grepErr.Error(),
			})
		}
		reportDone(targetFile)
		return nil
	})
}

func runRemoteGrepFile(
	ctx context.Context,
	client *ssh.Client,
	targetFile string,
	primaryOpts []string,
	filterConfigs []FilterConfig,
	args GrepArgs,
	outputParser remoteGrepOutputParser,
	highlightFilters []compiledFilter,
	highlighter searchHighlighter,
	onLine func(line GrepLine),
) error {
	session, err := openSSHSession(client)
	if err != nil {
		return fmt.Errorf("failed to create ssh session for %s: %w", targetFile, err)
	}
	defer session.Close()

	cmd := buildRemoteGrepCommand(primaryOpts, filterConfigs, []string{targetFile}, args)
	// 远程命令全文可能很长/含路径，仅 debug；需要排障时再开 Debug 级别
	logDebug("remote grep", map[string]any{"file": targetFile})

	stdoutPipe, err := session.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to get stdout pipe for %s: %w", targetFile, err)
	}

	stderrPipe, err := session.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to get stderr pipe for %s: %w", targetFile, err)
	}

	if err := session.Start(cmd); err != nil {
		return fmt.Errorf("failed to start remote command for %s: %w", targetFile, err)
	}

	var remoteErr []string
	stderrChan := make(chan struct{})
	go func() {
		r := bufio.NewReader(stderrPipe)
		for {
			line, _, err := r.ReadLine()
			if err != nil {
				break
			}
			remoteErr = append(remoteErr, string(line))
		}
		close(stderrChan)
	}()

	type remoteSearchDone struct {
		err error
	}
	doneChan := make(chan remoteSearchDone, 1)
	go func() {
		readErr := readRemoteGrepOutput(ctx, stdoutPipe, targetFile, args, outputParser, highlightFilters, highlighter, onLine)
		waitErr := session.Wait()
		if readErr != nil {
			waitErr = readErr
		}
		doneChan <- remoteSearchDone{err: waitErr}
	}()

	select {
	case <-ctx.Done():
		session.Close()
		logInfo("远程搜索已取消", map[string]any{"file": targetFile})
		return ctx.Err()
	case done := <-doneChan:
		<-stderrChan // 确保 stderr 读取完毕
		err := done.err
		if err != nil {
			// grep 没搜到匹配内容时，在 Linux 上会返回 Exit Code 1。
			// 这不应该是错误，只代表“没有匹配的行”。
			// Exit Code 2 或其他代表真正的执行错误（如文件找不到）
			exitErr, ok := err.(*ssh.ExitError)
			if ok && isBenignRemoteGrepExit(exitErr.ExitStatus()) {
				return nil
			}
			// 真正的错误，返回包含 stderr 的详情
			if len(remoteErr) > 0 {
				return fmt.Errorf("remote grep failed for %s: %s", targetFile, strings.Join(remoteErr, "\n"))
			}
			return fmt.Errorf("remote grep failed for %s: %w", targetFile, err)
		}
	}

	return nil
}

func readRemoteGrepOutput(
	ctx context.Context,
	stdoutPipe io.Reader,
	targetFile string,
	args GrepArgs,
	outputParser remoteGrepOutputParser,
	highlightFilters []compiledFilter,
	highlighter searchHighlighter,
	onLine func(line GrepLine),
) error {
	scanner := bufio.NewScanner(stdoutPipe)
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)

	var latestCollector *remoteLatestMatchCollector
	if args.MaxCount > 0 {
		latestCollector = newRemoteLatestMatchCollector(args, []string{targetFile}, highlightFilters, highlighter, onLine)
		latestCollector.trustContextFlags = true
	}

	firstLine := true
	for scanner.Scan() {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		line := scanner.Text()
		if firstLine {
			firstLine = false
			if latestCollector != nil && line == remoteOrderMarkerRev {
				latestCollector.reversed = true
				continue
			}
			if latestCollector != nil && line == remoteOrderMarkerFwd {
				continue
			}
		}

		parsed := outputParser.parse(line)
		if parsed.FilePath == "" {
			parsed.FilePath = targetFile
		}
		if latestCollector != nil {
			latestCollector.add(parsed)
			continue
		}

		matches := highlighter.displayMatches(line, parsed.Content)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		onLine(GrepLine{
			Text:      line,
			Matches:   matches,
			File:      parsed.FilePath,
			IsContext: parsed.IsContext,
		})
	}
	if err := scanner.Err(); err != nil {
		return err
	}

	if latestCollector != nil && ctx.Err() == nil {
		return latestCollector.flush(ctx)
	}
	return nil
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

// ExpandRemotePaths expands paths for callers that do not own a cancellable search context.
func ExpandRemotePaths(client *ssh.Client, paths []string) ([]string, error) {
	return expandRemotePaths(context.Background(), client, paths)
}

// RemoteLogFile is a concrete remote log file with the byte size captured when it was listed.
type RemoteLogFile struct {
	Path       string `json:"path"`
	SizeBytes  int64  `json:"sizeBytes"`
	ModifiedAt int64  `json:"modifiedAt"`
	MimeType   string `json:"mimeType"`
}

// ListRemoteLogFiles expands configured paths, then reads metadata for every concrete file on
// the same SSH client. The metadata is collected in one session to avoid per-file round trips.
func ListRemoteLogFiles(client *ssh.Client, paths []string) ([]RemoteLogFile, error) {
	targetFiles, err := ExpandRemotePaths(client, paths)
	if err != nil {
		return nil, err
	}
	return ReadRemoteLogFileInfo(client, targetFiles)
}

// ReadRemoteLogFileInfo reads inode metadata for already-expanded remote paths in one SSH session.
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

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'"
}

func shellQuoteGlob(value string) string {
	var parts []string
	var literal strings.Builder
	flushLiteral := func() {
		if literal.Len() == 0 {
			return
		}
		parts = append(parts, shellQuote(literal.String()))
		literal.Reset()
	}

	for _, ch := range value {
		switch ch {
		case '*', '?', '[', ']':
			flushLiteral()
			parts = append(parts, string(ch))
		default:
			literal.WriteRune(ch)
		}
	}
	flushLiteral()

	if len(parts) == 0 {
		return "''"
	}
	return strings.Join(parts, "")
}

const (
	remoteOrderMarkerRev = "\x1elog-searcher\x1erev"
	remoteOrderMarkerFwd = "\x1elog-searcher\x1efwd"
)

func canEarlyStopLatest(args GrepArgs) bool {
	if args.MaxCount <= 0 {
		return false
	}
	if args.FromTail && args.TailLines > 0 {
		return false
	}
	return args.ContextA <= 0 && args.ContextB <= 0 && args.ContextC <= 0
}

func buildRemoteGrepCommand(primaryOpts []string, filters []FilterConfig, targetFiles []string, args GrepArgs) string {
	if canEarlyStopLatest(args) {
		return buildRemoteLatestGrepCommand(primaryOpts, filters, targetFiles, args)
	}

	commands := []string{buildRemotePrimaryGrepCommand(primaryOpts, filters[0], targetFiles, args)}
	for _, filter := range filters[1:] {
		commands = append(commands, buildRemotePipeGrepCommand(filter))
	}

	return strings.Join(commands, " | ")
}

func buildRemoteLatestGrepCommand(primaryOpts []string, filters []FilterConfig, targetFiles []string, args GrepArgs) string {
	var commands []string
	for _, file := range targetFiles {
		trimmedFile := strings.TrimSpace(file)
		if trimmedFile == "" {
			continue
		}
		commands = append(commands, buildRemoteLatestFileCommand(primaryOpts, filters, trimmedFile, args.MaxCount))
	}
	if len(commands) == 0 {
		return "true"
	}
	if len(commands) == 1 {
		return commands[0]
	}
	return "( " + strings.Join(commands, "; ") + " )"
}

func buildRemoteLatestFileCommand(primaryOpts []string, filters []FilterConfig, file string, maxCount int) string {
	stdinPipeline := buildRemoteStdinGrepPipeline(primaryOpts, filters)
	filePipeline := buildRemoteFileGrepPipeline(primaryOpts, filters, file)
	return fmt.Sprintf(
		`if command -v tac >/dev/null 2>&1; then printf '%%s\n' %s; set -o pipefail; tac -- %s | %s | head -n %d; else printf '%%s\n' %s; %s | %s; fi`,
		shellQuote(remoteOrderMarkerRev),
		shellQuote(file),
		stdinPipeline,
		maxCount,
		shellQuote(remoteOrderMarkerFwd),
		filePipeline,
		buildRemoteLatestRingCommand(maxCount),
	)
}

func buildRemoteStdinGrepPipeline(primaryOpts []string, filters []FilterConfig) string {
	parts := []string{"grep"}
	parts = append(parts, primaryOpts...)
	parts = append(parts, "--", shellQuote(filters[0].Pattern))
	commands := []string{strings.Join(parts, " ")}
	for _, filter := range filters[1:] {
		commands = append(commands, buildRemotePipeGrepCommand(filter))
	}
	return strings.Join(commands, " | ")
}

func buildRemoteFileGrepPipeline(primaryOpts []string, filters []FilterConfig, file string) string {
	parts := []string{"grep"}
	parts = append(parts, primaryOpts...)
	parts = append(parts, "--", shellQuote(filters[0].Pattern), shellQuote(file))
	commands := []string{strings.Join(parts, " ")}
	for _, filter := range filters[1:] {
		commands = append(commands, buildRemotePipeGrepCommand(filter))
	}
	return strings.Join(commands, " | ")
}

func buildRemoteLatestRingCommand(maxCount int) string {
	script := `BEGIN{if(n<1)n=1}{buf[NR%n]=$0;c=NR}END{if(c<=n){for(i=1;i<=c;i++)print buf[i%n]}else{s=c%n;for(i=1;i<=n;i++)print buf[(s+i)%n]}}`
	return "awk -v n=" + strconv.Itoa(maxCount) + " " + shellQuote(script)
}

func buildRemotePrimaryOptions(args GrepArgs) []string {
	var primaryOpts []string
	if args.ShowFilename {
		primaryOpts = append(primaryOpts, "-H") // 总是显示文件名
	} else {
		primaryOpts = append(primaryOpts, "-h") // 隐藏文件名
	}
	if args.ShowLineNum {
		primaryOpts = append(primaryOpts, "-n") // 显示行号
	}

	if args.IgnoreCase {
		primaryOpts = append(primaryOpts, "-i")
	}
	if args.Invert {
		primaryOpts = append(primaryOpts, "-v")
	}
	if args.WordRegexp {
		primaryOpts = append(primaryOpts, "-w")
	}
	if args.Regexp {
		primaryOpts = append(primaryOpts, "-E")
	}
	if args.OnlyMatch {
		primaryOpts = append(primaryOpts, "-o")
	}

	// maxCount 由运行时有界缓冲实现，不能转换为 grep -m。
	if args.ContextC > 0 {
		primaryOpts = append(primaryOpts, "-C", strconv.Itoa(args.ContextC))
	} else {
		if args.ContextA > 0 {
			primaryOpts = append(primaryOpts, "-A", strconv.Itoa(args.ContextA))
		}
		if args.ContextB > 0 {
			primaryOpts = append(primaryOpts, "-B", strconv.Itoa(args.ContextB))
		}
	}
	return primaryOpts
}

func buildRemotePrimaryGrepCommand(primaryOpts []string, filter FilterConfig, targetFiles []string, args GrepArgs) string {
	if args.FromTail && args.TailLines > 0 {
		var perFileCommands []string
		for _, file := range targetFiles {
			trimmedFile := strings.TrimSpace(file)
			if trimmedFile == "" {
				continue
			}
			perFileCommands = append(perFileCommands, buildRemoteTailGrepCommand(primaryOpts, filter, trimmedFile, args))
		}
		if len(perFileCommands) == 0 {
			return "true"
		}
		return "( " + strings.Join(perFileCommands, "; ") + " )"
	}

	parts := []string{"grep"}
	parts = append(parts, primaryOpts...)
	parts = append(parts, "--", shellQuote(filter.Pattern))

	for _, file := range targetFiles {
		trimmedFile := strings.TrimSpace(file)
		if trimmedFile == "" {
			continue
		}
		parts = append(parts, shellQuote(trimmedFile))
	}

	return strings.Join(parts, " ")
}

func buildRemoteTailGrepCommand(primaryOpts []string, filter FilterConfig, file string, args GrepArgs) string {
	grepParts := []string{"grep", shellQuote("--label=" + file)}
	grepParts = append(grepParts, primaryOpts...)
	grepParts = append(grepParts, "--", shellQuote(filter.Pattern))

	cmd := fmt.Sprintf(
		"tail -n %d -- %s | %s",
		args.TailLines,
		shellQuote(file),
		strings.Join(grepParts, " "),
	)
	return cmd
}

func buildRemotePipeGrepCommand(filter FilterConfig) string {
	parts := []string{"grep"}
	if filter.IgnoreCase {
		parts = append(parts, "-i")
	}
	if filter.Invert {
		parts = append(parts, "-v")
	}
	if filter.WordRegexp {
		parts = append(parts, "-w")
	}
	if filter.Regexp {
		parts = append(parts, "-E")
	}
	parts = append(parts, "--", shellQuote(filter.Pattern))
	return strings.Join(parts, " ")
}

type remoteLatestMatchCollector struct {
	args              GrepArgs
	targetFiles       []string
	filters           []compiledFilter
	highlighter       searchHighlighter
	onLine            func(line GrepLine)
	files             map[string]*remoteLatestFileState
	sequence          int
	defaultSource     string
	reversed          bool
	trustContextFlags bool
}

type remoteLatestFileState struct {
	groups       *matchOutputGroupRing
	openGroups   []*matchOutputGroup
	history      []grepOutputItem
	fallbackLine int
	lastMatch    *matchOutputGroup
	lastLineNum  int
	lastSource   string
}

func newRemoteLatestMatchCollector(args GrepArgs, targetFiles []string, filters []compiledFilter, highlighter searchHighlighter, onLine func(line GrepLine)) *remoteLatestMatchCollector {
	defaultSource := ""
	if len(targetFiles) == 1 {
		defaultSource = targetFiles[0]
	}
	return &remoteLatestMatchCollector{
		args:          args,
		targetFiles:   targetFiles,
		filters:       filters,
		highlighter:   highlighter,
		onLine:        onLine,
		files:         make(map[string]*remoteLatestFileState),
		defaultSource: defaultSource,
	}
}

func (collector *remoteLatestMatchCollector) nextSequence() int {
	collector.sequence++
	return collector.sequence
}

func (collector *remoteLatestMatchCollector) add(parsed remoteGrepLine) {
	if parsed.IsSeparator {
		collector.resetContextState()
		return
	}

	sourceKey := parsed.FilePath
	if sourceKey == "" {
		sourceKey = collector.defaultSource
	}
	state := collector.fileState(sourceKey)
	lineNum := parsed.LineNum
	if lineNum <= 0 {
		state.fallbackLine++
		lineNum = state.fallbackLine
	}

	isMatch := collector.lineIsMatch(parsed)

	if isMatch {
		group := state.lastMatch
		if !collector.args.OnlyMatch || group == nil || state.lastLineNum != lineNum || state.lastSource != sourceKey {
			group = &matchOutputGroup{matchLineNum: lineNum}
			for _, item := range state.history {
				group.add(item)
			}
			evicted := state.groups.add(group)
			state.openGroups = removeOpenMatchGroup(state.openGroups, evicted)
			if collector.contextA() > 0 {
				state.openGroups = append(state.openGroups, group)
			}
			state.lastMatch = group
			state.lastLineNum = lineNum
			state.lastSource = sourceKey
		}
		group.add(collector.makeItem(parsed, lineNum, sourceKey, true, false))
		return
	}

	if collector.contextA() <= 0 {
		collector.rememberContextLine(state, parsed, lineNum, sourceKey)
		return
	}

	for _, group := range state.openGroups {
		if lineNum > group.matchLineNum && lineNum-group.matchLineNum <= collector.contextA() {
			group.add(collector.makeItem(parsed, lineNum, sourceKey, false, true))
		}
	}
	state.openGroups = pruneOpenMatchGroups(state.openGroups, lineNum, collector.contextA())
	collector.rememberContextLine(state, parsed, lineNum, sourceKey)
}

func (collector *remoteLatestMatchCollector) fileState(sourceKey string) *remoteLatestFileState {
	key := sourceKey
	if key == "" {
		key = "__unknown__"
	}
	if collector.files[key] == nil {
		collector.files[key] = &remoteLatestFileState{
			groups: newMatchOutputGroupRing(collector.args.MaxCount),
		}
	}
	return collector.files[key]
}

func (collector *remoteLatestMatchCollector) resetContextState() {
	for _, state := range collector.files {
		state.openGroups = nil
		state.history = nil
		state.lastMatch = nil
		state.lastLineNum = 0
		state.lastSource = ""
	}
}

func (collector *remoteLatestMatchCollector) contextA() int {
	if collector.args.ContextC > 0 {
		return collector.args.ContextC
	}
	return collector.args.ContextA
}

func (collector *remoteLatestMatchCollector) contextB() int {
	if collector.args.ContextC > 0 {
		return collector.args.ContextC
	}
	return collector.args.ContextB
}

func (collector *remoteLatestMatchCollector) rememberContextLine(state *remoteLatestFileState, parsed remoteGrepLine, lineNum int, sourceKey string) {
	if collector.contextB() <= 0 {
		return
	}
	state.history = append(state.history, collector.makeItem(parsed, lineNum, sourceKey, false, true))
	if len(state.history) > collector.contextB() {
		state.history = state.history[1:]
	}
}

func (collector *remoteLatestMatchCollector) lineIsMatch(parsed remoteGrepLine) bool {
	if collector.contextA() <= 0 && collector.contextB() <= 0 {
		return !parsed.IsSeparator
	}
	if collector.trustContextFlags {
		return !parsed.IsContext
	}
	if len(collector.filters) == 0 {
		return !parsed.IsContext
	}
	return matchesAllFilters(parsed.Content, collector.filters)
}

func (collector *remoteLatestMatchCollector) makeItem(parsed remoteGrepLine, lineNum int, sourceKey string, isMatch bool, isContext bool) grepOutputItem {
	return grepOutputItem{
		lineNum:   lineNum,
		sequence:  collector.nextSequence(),
		sourceKey: sourceKey,
		isMatch:   isMatch,
		content:   parsed.Content,
		line:      collector.makeLine(parsed, lineNum, isContext),
	}
}

func (collector *remoteLatestMatchCollector) makeLine(parsed remoteGrepLine, lineNum int, isContext bool) GrepLine {
	filename := parsed.FilePath
	if filename != "" {
		filename = remoteDisplayFilename(filename, collector.targetFiles)
	}
	displayText := formatLine(filename, lineNum, parsed.Content, isContext, collector.args)
	return GrepLine{
		Text:      displayText,
		File:      parsed.FilePath,
		IsContext: isContext,
	}
}

func (collector *remoteLatestMatchCollector) highlightKeptGroups(groups []*matchOutputGroup) {
	for _, group := range groups {
		for index := range group.items {
			item := &group.items[index]
			item.line.Matches = collector.highlighter.displayMatches(item.line.Text, item.content)
		}
	}
}

func (collector *remoteLatestMatchCollector) flushFile(ctx context.Context, state *remoteLatestFileState) error {
	groups := state.groups.groupsOldestFirst()
	if collector.reversed {
		reverseMatchOutputGroups(groups)
		collector.highlightKeptGroups(groups)
		return emitMatchOutputGroups(ctx, groups, collector.onLine)
	}
	collector.highlightKeptGroups(groups)
	return flushMatchOutputGroups(ctx, groups, collector.onLine)
}

func (collector *remoteLatestMatchCollector) flush(ctx context.Context) error {
	for _, file := range collector.targetFiles {
		state := collector.files[file]
		if state == nil {
			continue
		}
		if err := collector.flushFile(ctx, state); err != nil {
			return err
		}
		delete(collector.files, file)
	}
	for key, state := range collector.files {
		if err := collector.flushFile(ctx, state); err != nil {
			return err
		}
		delete(collector.files, key)
	}
	return nil
}

func reverseMatchOutputGroups(groups []*matchOutputGroup) {
	for i, j := 0, len(groups)-1; i < j; i, j = i+1, j-1 {
		groups[i], groups[j] = groups[j], groups[i]
	}
}

func remoteDisplayFilename(filePath string, targetFiles []string) string {
	return filePath
}

type remoteGrepOutputParser struct {
	args        GrepArgs
	targetFiles []string
}

type remoteGrepLine struct {
	Raw         string
	FilePath    string
	LineNum     int
	Content     string
	IsContext   bool
	IsSeparator bool
}

func newRemoteGrepOutputParser(args GrepArgs, targetFiles []string) remoteGrepOutputParser {
	files := make([]string, 0, len(targetFiles))
	for _, file := range targetFiles {
		trimmedFile := strings.TrimSpace(file)
		if trimmedFile != "" {
			files = append(files, trimmedFile)
		}
	}
	sort.Slice(files, func(i, j int) bool {
		return len(files[i]) > len(files[j])
	})

	return remoteGrepOutputParser{
		args:        args,
		targetFiles: files,
	}
}

func (parser remoteGrepOutputParser) content(line string) string {
	return parser.parse(line).Content
}

func (parser remoteGrepOutputParser) parse(line string) remoteGrepLine {
	content := line
	filePath := ""
	isContext := false
	lineNum := 0
	if line == "--" {
		return remoteGrepLine{Raw: line, Content: line, IsSeparator: true}
	}

	if parser.args.ShowFilename {
		var ok bool
		filePath, content, isContext, ok = parser.stripFilenamePrefix(content)
		if !ok {
			filePath = ""
		}
	} else if len(parser.targetFiles) == 1 {
		filePath = parser.targetFiles[0]
	}

	if parser.args.ShowLineNum {
		var parsedLineNum int
		content, parsedLineNum, isContext = stripLineNumberPrefix(content)
		if parsedLineNum > 0 {
			lineNum = parsedLineNum
		}
	}
	return remoteGrepLine{
		Raw:       line,
		FilePath:  filePath,
		LineNum:   lineNum,
		Content:   content,
		IsContext: isContext,
	}
}

func (parser remoteGrepOutputParser) stripFilenamePrefix(line string) (string, string, bool, bool) {
	for _, file := range parser.targetFiles {
		if len(line) <= len(file) || !strings.HasPrefix(line, file) {
			continue
		}

		separator := line[len(file)]
		if separator == ':' || separator == '-' {
			return file, line[len(file)+1:], separator == '-', true
		}
	}

	return "", line, false, false
}

func stripLineNumberPrefix(line string) (string, int, bool) {
	if line == "" {
		return line, 0, false
	}

	for index, ch := range line {
		if ch >= '0' && ch <= '9' {
			continue
		}
		if index > 0 && (ch == ':' || ch == '-') {
			lineNum, err := strconv.Atoi(line[:index])
			if err != nil {
				return line, 0, false
			}
			return line[index+1:], lineNum, ch == '-'
		}
		return line, 0, false
	}

	return line, 0, false
}

func buildRemoteExpandCommand(path string) string {
	return "sh -c " + shellQuote(buildRemoteExpandScript(path))
}

func buildRemoteFileInfoCommand(paths []string) string {
	quotedPaths := make([]string, 0, len(paths))
	for _, path := range paths {
		quotedPaths = append(quotedPaths, shellQuote(path))
	}
	// 只用 inode 元数据：wc -c 会读完整文件，file --mime-type 会为每个文件再 fork 一次。
	script := fmt.Sprintf(`for path in %s; do [ -f "$path" ] || continue; meta=$(stat -c '%%s %%Y' -- "$path" 2>/dev/null || stat -f '%%z %%m' -- "$path" 2>/dev/null) || continue; size=${meta%% *}; modified_at=${meta#* }; printf '%%s\t%%s\t%%s\t%%s\n' "$size" "$modified_at" "" "$path"; done`, strings.Join(quotedPaths, " "))
	return "sh -c " + shellQuote(script)
}

func buildRemoteExpandScript(path string) string {
	quotedPath := shellQuote(path)
	var globExpr string
	if strings.ContainsAny(path, "*?[]") {
		globExpr = shellQuoteGlob(path)
	} else {
		globExpr = shellQuote(path)
	}

	// globExpr 仅在用户显式输入通配符时保留 shell 展开能力；普通路径始终强制引用。
	return fmt.Sprintf(`path=%s; if [ -d "$path" ]; then for f in "$path"/*; do [ -f "$f" ] && printf '%%s\n' "$f"; done; else for f in %s; do [ -f "$f" ] && printf '%%s\n' "$f"; done; fi`, quotedPath, globExpr)
}
