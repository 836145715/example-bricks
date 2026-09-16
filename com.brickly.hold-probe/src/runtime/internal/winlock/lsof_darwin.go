//go:build darwin

package winlock

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sys/unix"
)

const lsofPath = "/usr/sbin/lsof"

type lsofFile struct {
	FD   string
	Type string
	Name string
}

type lsofProcess struct {
	PID     uint32
	Command string
	Files   []lsofFile
}

func Probe(path string, kind string, deep bool) (Result, error) {
	limit := 8 * time.Second
	if deep {
		limit = 15 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), limit)
	defer cancel()

	cmd := exec.CommandContext(ctx, lsofPath, lsofArgs(path, kind, deep)...)
	// Avoid reporting lsof itself when the target contains the Brick runtime cwd.
	cmd.Dir = "/"
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	warning := ""
	if ctx.Err() != nil {
		return Result{}, fmt.Errorf("%w: lsof timed out after %s", ErrProbe, limit)
	}
	if err != nil {
		exitCode := -1
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			exitCode = exitErr.ExitCode()
		}
		warning, err = classifyLsofExit(exitCode, stdout.Bytes(), stderr.Bytes())
		if err != nil {
			return Result{}, err
		}
	}

	processes, err := parseLsofMachineOutput(stdout.Bytes())
	if err != nil {
		return Result{}, err
	}
	holders := make([]Holder, 0, len(processes))
	for _, process := range processes {
		if process.PID == 0 || process.PID == uint32(os.Getpid()) || process.Command == "lsof" {
			continue
		}
		holder, ok := lsofHolder(process)
		if ok {
			holders = append(holders, holder)
		}
	}
	sort.Slice(holders, func(i, j int) bool {
		if holders[i].ProcessName == holders[j].ProcessName {
			return holders[i].PID < holders[j].PID
		}
		return holders[i].ProcessName < holders[j].ProcessName
	})

	notes := []string{"macOS 使用 lsof 生成瞬时文件使用快照；受系统权限限制，结果可能不完整。"}
	if warning != "" {
		notes = append(notes, "lsof 部分扫描警告: "+warning)
	}
	if kind == "directory" && !deep {
		notes = append(notes, "当前仅扫描目录直属内容；可开启深度扫描递归检查子目录。")
	}
	return Result{
		Path:     path,
		Kind:     kind,
		Count:    len(holders),
		Holders:  holders,
		DeepUsed: deep,
		Notes:    notes,
		ProbedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}, nil
}

func lsofArgs(path string, kind string, deep bool) []string {
	args := []string{"-nP", "-F0pcftn"}
	if kind == "directory" {
		if deep {
			return append(args, "+D", path)
		}
		return append(args, "+d", path)
	}
	return append(args, "--", path)
}

func parseLsofMachineOutput(raw []byte) ([]lsofProcess, error) {
	var processes []lsofProcess
	var current *lsofProcess
	for _, record := range bytes.Split(raw, []byte{'\n'}) {
		if len(record) == 0 {
			continue
		}
		fields := bytes.Split(record, []byte{0})
		if len(fields) == 0 || len(fields[0]) == 0 {
			continue
		}
		switch fields[0][0] {
		case 'p':
			pid, err := strconv.ParseUint(string(fields[0][1:]), 10, 32)
			if err != nil || pid == 0 {
				return nil, fmt.Errorf("%w: invalid lsof pid record %q", ErrProbe, fields[0])
			}
			processes = append(processes, lsofProcess{PID: uint32(pid)})
			current = &processes[len(processes)-1]
			for _, field := range fields[1:] {
				if len(field) > 1 && field[0] == 'c' {
					current.Command = string(field[1:])
				}
			}
		case 'f':
			if current == nil {
				return nil, fmt.Errorf("%w: lsof file record without process", ErrProbe)
			}
			file := lsofFile{FD: string(fields[0][1:])}
			for _, field := range fields[1:] {
				if len(field) <= 1 {
					continue
				}
				switch field[0] {
				case 't':
					file.Type = string(field[1:])
				case 'n':
					file.Name = string(field[1:])
				}
			}
			current.Files = append(current.Files, file)
		}
	}
	return processes, nil
}

func classifyLsofExit(exitCode int, stdout []byte, stderr []byte) (string, error) {
	message := strings.TrimSpace(string(stderr))
	if exitCode == 1 && message == "" {
		return "", nil
	}
	if exitCode == 1 && len(stdout) > 0 {
		return message, nil
	}
	lower := strings.ToLower(message)
	if strings.Contains(lower, "permission denied") || strings.Contains(lower, "operation not permitted") {
		return "", fmt.Errorf("%w: %s", ErrAccess, message)
	}
	if message == "" {
		message = fmt.Sprintf("exit code %d", exitCode)
	}
	return "", fmt.Errorf("%w: lsof: %s", ErrProbe, message)
}

func lsofHolder(process lsofProcess) (Holder, bool) {
	kinfo, err := unix.SysctlKinfoProc("kern.proc.pid", int(process.PID))
	if err != nil {
		return Holder{}, false
	}
	started := kinfo.Proc.P_starttime
	startMicros := started.Sec*1_000_000 + int64(started.Usec)
	if startMicros <= 0 {
		return Holder{}, false
	}
	applicationType := "open-file"
	for _, file := range process.Files {
		switch file.FD {
		case "cwd":
			applicationType = "working-directory"
		case "txt":
			if applicationType == "open-file" {
				applicationType = "executable"
			}
		}
	}
	sessionID := uint32(0)
	if sid, sidErr := unix.Getsid(int(process.PID)); sidErr == nil && sid >= 0 {
		sessionID = uint32(sid)
	}
	name := strings.TrimSpace(process.Command)
	if name == "" {
		name = fmt.Sprintf("pid-%d", process.PID)
	}
	return Holder{
		PID:             process.PID,
		StartKey:        strconv.FormatInt(startMicros, 10),
		ProcessName:     name,
		ApplicationType: applicationType,
		Status:          1,
		Restartable:     false,
		SessionID:       sessionID,
		StartedAt:       time.Unix(started.Sec, int64(started.Usec)*1_000).UTC().Format(time.RFC3339Nano),
		Sources:         []Source{SourceLsof},
	}, true
}
