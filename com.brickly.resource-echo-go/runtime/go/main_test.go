package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"strings"
	"testing"

	brickly "github.com/836145715/brickly-sdk-go"
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
	reader := newPatternReader(1024*1024+17, 0x61, 64*1024)
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

func TestPatternReaderHonorsChunkSizeAndZeroByte(t *testing.T) {
	reader := newPatternReader(10, 0, 3)
	buffer := make([]byte, 8)
	for expected := 3; expected > 0; expected-- {
		n, err := reader.Read(buffer)
		if err != nil || n != 3 || buffer[0] != 0 {
			t.Fatalf("read n=%d err=%v first=%d", n, err, buffer[0])
		}
	}
	n, err := reader.Read(buffer)
	if err != nil || n != 1 || buffer[0] != 0 {
		t.Fatalf("final read n=%d err=%v first=%d", n, err, buffer[0])
	}
}

func TestOpenInputResourceUsesRuntimeOpenResource(t *testing.T) {
	runtime := brickly.New(brickly.Options{BrickID: "com.test.resource-input", Stdin: strings.NewReader(""), Stdout: io.Discard, Stderr: io.Discard})
	ref := brickly.ResourceRef{
		Kind: "brickly.resource", ResourceID: "res_go", AccessToken: "token",
		SizeBytes: 1, SHA256: strings.Repeat("a", 64), ExpiresAt: 2_000_000_000_000,
	}
	input, handle, err := openInputResource(runtime, json.RawMessage(`{"resource":{"kind":"brickly.resource","resourceId":"res_go","accessToken":"token","sizeBytes":1,"sha256":"`+strings.Repeat("a", 64)+`","expiresAt":2000000000000}}`))
	if err != nil {
		t.Fatal(err)
	}
	if input.Resource.ResourceID != ref.ResourceID || handle.Ref.ResourceID != ref.ResourceID {
		t.Fatalf("unexpected resource input: input=%+v handle=%+v", input.Resource, handle.Ref)
	}
}
