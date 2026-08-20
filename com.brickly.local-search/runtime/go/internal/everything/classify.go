package everything

type ClassifyInput struct {
	DLLExists      bool
	DLLLoaded      bool
	IPCReady       bool
	IPCConnected   bool
	LastError      uint32
	InstallPath    string
	ProcessRunning bool
	Unsupported    bool
}

func Classify(input ClassifyInput) HealthReason {
	if input.Unsupported {
		return ReasonUnsupported
	}
	if !input.DLLExists || !input.DLLLoaded {
		return ReasonMissingSDK
	}
	if input.IPCReady {
		return ReasonReady
	}
	// IPC 已通，或 last error 不是 IPC：Everything 在跑，只是库还没装完。
	if input.IPCConnected || input.LastError != ErrorIPC {
		return ReasonIndexing
	}
	if input.ProcessRunning {
		return ReasonIpcUnavailable
	}
	if input.InstallPath == "" {
		return ReasonNotInstalled
	}
	return ReasonNotRunning
}

func ReasonMessage(reason HealthReason) string {
	switch reason {
	case ReasonReady:
		return ""
	case ReasonMissingSDK:
		return "工具自带的 Everything SDK 缺失，请重新安装本工具。"
	case ReasonNotInstalled:
		return "捆绑的 Everything 缺失，请重新安装本工具。"
	case ReasonNotRunning:
		return "正在后台启动捆绑的 Everything…"
	case ReasonIndexing:
		return "Everything 已连接，正在建立索引…"
	case ReasonIpcUnavailable:
		return "捆绑的 Everything 已启动，但索引通道尚未接通，请稍候。"
	case ReasonUnsupported:
		return "本地搜索目前仅支持 Windows x64。"
	default:
		return "Everything 索引未就绪。"
	}
}
