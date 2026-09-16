package Service

// PlatformClipboardRead / Write 由 main 在 OnReady 注入，走 SDK Platform.Clipboard。
// 未注入或调用失败时 ClipboardReadAll / ClipboardWriteAll 回退本机实现。
var (
	PlatformClipboardRead  func() (string, error)
	PlatformClipboardWrite func(text string) error
)

// ClipboardTextFromSnapshot 从 Platform.Clipboard.ReadContent 快照取文本。
func ClipboardTextFromSnapshot(snap map[string]any) string {
	return clipboardTextFromSnapshot(snap)
}

func clipboardTextFromSnapshot(snap map[string]any) string {
	if snap == nil {
		return ""
	}
	if t, ok := snap["text"].(string); ok && t != "" {
		return t
	}
	if t, ok := snap["textPreview"].(string); ok {
		return t
	}
	return ""
}
