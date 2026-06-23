package stdoutguard

import "os"

var protocolStdout *os.File

func init() {
	protocolStdout = os.Stdout
	os.Stdout = os.Stderr
}

// ProtocolStdout 返回进程启动时的原始 stdout，专供 BPP JSON Lines 使用。
func ProtocolStdout() *os.File {
	if protocolStdout == nil {
		return os.Stdout
	}
	return protocolStdout
}
