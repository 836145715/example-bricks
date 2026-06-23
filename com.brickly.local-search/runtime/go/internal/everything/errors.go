package everything

import "fmt"

type SDKError struct {
	Code uint32
	Text string
}

func (e *SDKError) Error() string {
	if e == nil {
		return ""
	}
	if e.Text != "" {
		return e.Text
	}
	return fmt.Sprintf("Everything SDK 错误: %d", e.Code)
}

func errorText(code uint32) string {
	switch code {
	case ErrorOK:
		return ""
	case ErrorMemory:
		return "Everything SDK 内存不足"
	case ErrorIPC:
		return "Everything 搜索客户端未运行或 IPC 不可用"
	case ErrorRegisterClassEx:
		return "Everything SDK 注册窗口类失败"
	case ErrorCreateWindow:
		return "Everything SDK 创建监听窗口失败"
	case ErrorCreateThread:
		return "Everything SDK 创建监听线程失败"
	case ErrorInvalidIndex:
		return "Everything SDK 结果索引无效"
	case ErrorInvalidCall:
		return "Everything SDK 调用顺序无效"
	case ErrorInvalidRequest:
		return "Everything SDK 请求数据无效"
	case ErrorInvalidParameter:
		return "Everything SDK 参数无效"
	default:
		return fmt.Sprintf("Everything SDK 未知错误: %d", code)
	}
}
