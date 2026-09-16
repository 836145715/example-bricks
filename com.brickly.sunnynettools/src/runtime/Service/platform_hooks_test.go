package Service

import "testing"

func TestClipboardTextFromSnapshot(t *testing.T) {
	if got := clipboardTextFromSnapshot(nil); got != "" {
		t.Fatalf("nil: %q", got)
	}
	if got := clipboardTextFromSnapshot(map[string]any{"text": "hello"}); got != "hello" {
		t.Fatalf("text: %q", got)
	}
	if got := clipboardTextFromSnapshot(map[string]any{"textPreview": "prev"}); got != "prev" {
		t.Fatalf("preview: %q", got)
	}
}
