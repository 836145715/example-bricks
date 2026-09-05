// Package stdoutguard 把 os.Stdout 换成 stderr，防止业务输出污染 gRPC 协议 stdout。
// 照抄 com.brickly.port-inspector/runtime/go/internal/stdoutguard。
package stdoutguard

import "os"

var protocolStdout *os.File

func init() {
	protocolStdout = os.Stdout
	os.Stdout = os.Stderr
}

// ProtocolStdout 返回协议专用的原始 stdout。
func ProtocolStdout() *os.File {
	if protocolStdout == nil {
		return os.Stdout
	}
	return protocolStdout
}
