// 负责远程 SSH grep 的并发调度、流式结果读取、前缀解析与退出码判断
package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
	"sync"

	"golang.org/x/crypto/ssh"
)

func runRemoteGrepWithFileLifecycle(
	ctx context.Context,
	server ServerConfig,
	pattern string,
	files []string,
	args GrepArgs,
	onFiles func(files []string),
	onFileStart func(filePath string),
	onFileDone func(filePath string),
	onLine grepLineHandler,
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
	reportLine := func(line GrepLine) bool {
		callbacks.Lock()
		defer callbacks.Unlock()
		return onLine(line)
	}

	return runFileJobs(ctx, targetFiles, func(targetFile string) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		reportStart(targetFile)

		grepErr := runRemoteGrepFile(ctx, client, targetFile, primaryOpts, filterConfigs, args, outputParser, highlighter, reportLine)
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
	highlighter searchHighlighter,
	onLine grepLineHandler,
) error {
	session, err := openSSHSession(client)
	if err != nil {
		return fmt.Errorf("failed to create ssh session for %s: %w", targetFile, err)
	}
	defer session.Close()

	cmd := buildRemoteGrepCommand(primaryOpts, filterConfigs, []string{targetFile}, args)
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
		readErr := readRemoteGrepOutput(ctx, stdoutPipe, targetFile, args, outputParser, highlighter, onLine)
		if errors.Is(readErr, errSearchLineLimit) {
			_ = session.Close()
			_ = session.Wait()
			doneChan <- remoteSearchDone{err: nil}
			return
		}
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
		<-stderrChan
		err := done.err
		if err != nil {
			exitErr, ok := err.(*ssh.ExitError)
			if ok && isBenignRemoteGrepExit(exitErr.ExitStatus()) {
				return nil
			}
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
	highlighter searchHighlighter,
	onLine grepLineHandler,
) error {
	scanner := bufio.NewScanner(stdoutPipe)
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)

	for scanner.Scan() {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		parsed := outputParser.parse(scanner.Text())
		if parsed.FilePath == "" {
			parsed.FilePath = targetFile
		}

		displayText := parsed.Content
		if args.ShowFilename || args.ShowLineNum {
			displayText = formatLine(parsed.FilePath, parsed.LineNum, parsed.Content, parsed.IsContext, args)
		}
		matches := highlighter.displayMatches(displayText, parsed.Content)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if onLine(GrepLine{
			Text:      displayText,
			Matches:   matches,
			File:      parsed.FilePath,
			IsContext: parsed.IsContext,
		}) {
			return errSearchLineLimit
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	return nil
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

	if strippedFile, rest, fileIsContext, ok := parser.stripFilenamePrefix(content); ok {
		filePath = strippedFile
		content = rest
		isContext = fileIsContext
	} else if len(parser.targetFiles) == 1 {
		filePath = parser.targetFiles[0]
	}

	if parser.args.ShowLineNum {
		stripped, parsedLineNum, lineIsContext := stripLineNumberPrefix(content)
		if parsedLineNum > 0 {
			content = stripped
			lineNum = parsedLineNum
			isContext = lineIsContext
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
