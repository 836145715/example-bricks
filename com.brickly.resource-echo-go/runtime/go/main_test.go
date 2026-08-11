package main

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"strings"
	"testing"
)

func TestInspectReaderCountsBytesAndHash(t *testing.T) {
	result, err := inspectReader(strings.NewReader("hello resource"), "go", "text/plain", 4)
	if err != nil {
		t.Fatal(err)
	}
	expected := sha256.Sum256([]byte("hello resource"))
	if result.Runtime != "go" || result.SizeBytes != 14 || result.SHA256 != hex.EncodeToString(expected[:]) {
		t.Fatalf("unexpected result: %#v", result)
	}
	if result.ChunkCount < 2 || result.MIMEType != "text/plain" {
		t.Fatalf("unexpected chunk metadata: %#v", result)
	}
}

func TestPatternReaderStreamsBoundedData(t *testing.T) {
	reader := newPatternReader(1024*1024+17, 0x61)
	buffer := make([]byte, 64*1024)
	total := 0
	reads := 0
	for {
		n, err := reader.Read(buffer)
		total += n
		if n > 0 {
			reads++
			if buffer[0] != 0x61 {
				t.Fatalf("unexpected pattern byte: %x", buffer[0])
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	if total != 1024*1024+17 || reads != 17 {
		t.Fatalf("total=%d reads=%d", total, reads)
	}
}
