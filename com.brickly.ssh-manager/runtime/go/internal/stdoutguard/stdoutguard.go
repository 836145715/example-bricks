package stdoutguard

import "os"

var protocolStdout *os.File

func init() {
	protocolStdout = os.Stdout
	os.Stdout = os.Stderr
}

func ProtocolStdout() *os.File {
	if protocolStdout == nil {
		return os.Stdout
	}
	return protocolStdout
}
