// 负责远程 Linux 命令拼装、Shell 字符串转义以及管道过滤语法生成
package main

import (
	"fmt"
	"strconv"
	"strings"
)

/** 单引号安全转义 */
func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'"
}

/** 通配符转义：普通字符加引号，保留 * ? [ ] 的 shell 展开能力 */
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

/** 是否使用尾部字节窗口模式 */
func usesRemoteTailWindow(args GrepArgs) bool {
	return args.TailBytes > 0
}

/** 构建远程 Linux grep 执行命令（支持多管道链式过滤和 tail 截取） */
func buildRemoteGrepCommand(primaryOpts []string, filters []FilterConfig, targetFiles []string, args GrepArgs) string {
	commands := []string{buildRemotePrimaryGrepCommand(primaryOpts, filters[0], targetFiles, args)}
	for _, filter := range filters[1:] {
		commands = append(commands, buildRemotePipeGrepCommand(filter))
	}
	return capRemoteGrepOutput(strings.Join(commands, " | "))
}

/** 为命令添加单文件最大保留行数截断（安全上限） */
func capRemoteGrepOutput(command string) string {
	if command == "" || command == "true" {
		return command
	}
	return command + " | head -n " + strconv.Itoa(maxStoredLinesPerFile)
}

/** 构建主 grep 选项参数 */
func buildRemotePrimaryOptions(args GrepArgs) []string {
	var primaryOpts []string
	if args.ShowFilename {
		primaryOpts = append(primaryOpts, "-H")
	} else {
		primaryOpts = append(primaryOpts, "-h")
	}
	if args.ShowLineNum {
		primaryOpts = append(primaryOpts, "-n")
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
	if usesRemoteTailWindow(args) {
		var perFileCommands []string
		for _, file := range targetFiles {
			trimmedFile := strings.TrimSpace(file)
			if trimmedFile == "" {
				continue
			}
			perFileCommands = append(perFileCommands, buildRemoteTailGrepCommand(primaryOpts, filter, trimmedFile, args.TailBytes))
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

func buildRemoteTailGrepCommand(primaryOpts []string, filter FilterConfig, file string, tailBytes int) string {
	grepParts := []string{"grep", shellQuote("--label=" + file)}
	grepParts = append(grepParts, primaryOpts...)
	grepParts = append(grepParts, "--", shellQuote(filter.Pattern))
	return fmt.Sprintf(
		"tail -c %d -- %s | %s",
		tailBytes,
		shellQuote(file),
		strings.Join(grepParts, " "),
	)
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

/** 构建批量读取远程文件 inode 大小与修改时间的命令 */
func buildRemoteFileInfoCommand(paths []string) string {
	quotedPaths := make([]string, 0, len(paths))
	for _, path := range paths {
		quotedPaths = append(quotedPaths, shellQuote(path))
	}
	script := fmt.Sprintf(`for path in %s; do [ -f "$path" ] || continue; meta=$(stat -c '%%s %%Y' -- "$path" 2>/dev/null || stat -f '%%z %%m' -- "$path" 2>/dev/null) || continue; size=${meta%% *}; modified_at=${meta#* }; printf '%%s\t%%s\t%%s\t%%s\n' "$size" "$modified_at" "" "$path"; done`, strings.Join(quotedPaths, " "))
	return "sh -c " + shellQuote(script)
}

/** 构建通配符或目录文件展开脚本 */
func buildRemoteExpandCommand(path string) string {
	return "sh -c " + shellQuote(buildRemoteExpandScript(path))
}

func buildRemoteExpandScript(path string) string {
	quotedPath := shellQuote(path)
	var globExpr string
	if strings.ContainsAny(path, "*?[]") {
		globExpr = shellQuoteGlob(path)
	} else {
		globExpr = shellQuote(path)
	}
	return fmt.Sprintf(`path=%s; if [ -d "$path" ]; then for f in "$path"/*; do [ -f "$f" ] && printf '%%s\n' "$f"; done; else for f in %s; do [ -f "$f" ] && printf '%%s\n' "$f"; done; fi`, quotedPath, globExpr)
}
