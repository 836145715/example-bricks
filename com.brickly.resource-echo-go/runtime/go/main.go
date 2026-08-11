package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"time"

	brickly "github.com/836145715/brickly-sdk-go"
)

const brickID = "com.brickly.resource-echo-go"

type inspectResult struct {
	Runtime    string `json:"runtime"`
	SizeBytes  int64  `json:"sizeBytes"`
	ChunkCount int64  `json:"chunkCount"`
	SHA256     string `json:"sha256"`
	MIMEType   string `json:"mimeType"`
}

type resourceInput struct {
	Resource        brickly.ResourceRef `json:"resource"`
	SizeBytes       int64               `json:"sizeBytes"`
	ChunkBytes      int                 `json:"chunkBytes"`
	Byte            byte                `json:"byte"`
	MIMEType        string              `json:"mimeType"`
	Name            string              `json:"name"`
	TTLMillis       int64               `json:"ttlMs"`
	Mask            byte                `json:"mask"`
	DelayMillis     int                 `json:"delayMs"`
	TargetBrickID   string              `json:"targetBrickId"`
	TargetCommandID string              `json:"targetCommandId"`
}

type patternReader struct {
	remaining int64
	value     byte
}

func main() {
	runtime := brickly.New(brickly.Options{BrickID: brickID})
	var lastEvent any

	runtime.OnCommand("inspect", func(ctx *brickly.CommandContext, raw json.RawMessage) (any, error) {
		input, handle, err := hydrateInput(ctx, raw)
		if err != nil {
			return nil, err
		}
		defer handle.Close()
		return inspectReader(handle, "go", input.Resource.MimeType, 64*1024)
	})

	runtime.OnCommand("produce", func(ctx *brickly.CommandContext, raw json.RawMessage) (any, error) {
		var input resourceInput
		if err := json.Unmarshal(raw, &input); err != nil {
			return nil, err
		}
		if input.SizeBytes < 0 {
			return nil, brickly.NewBppError("INVALID_INPUT", "sizeBytes is invalid")
		}
		if input.MIMEType == "" {
			input.MIMEType = "application/octet-stream"
		}
		if input.Name == "" {
			input.Name = fmt.Sprintf("go-%d.bin", input.SizeBytes)
		}
		return ctx.CreateResourceFrom(newPatternReader(input.SizeBytes, defaultByte(input.Byte)), &brickly.ResourceCreateOptions{
			MimeType: input.MIMEType, Name: input.Name, TTLMillis: input.TTLMillis, ExpectedSizeBytes: input.SizeBytes,
		})
	})

	runtime.OnCommand("transform", func(ctx *brickly.CommandContext, raw json.RawMessage) (any, error) {
		input, handle, err := hydrateInput(ctx, raw)
		if err != nil {
			return nil, err
		}
		defer handle.Close()
		return ctx.CreateResourceFrom(&xorReader{source: handle, mask: defaultMask(input.Mask)}, &brickly.ResourceCreateOptions{
			MimeType: input.Resource.MimeType, Name: "go-transformed-" + input.Resource.Name, ExpectedSizeBytes: input.Resource.SizeBytes,
		})
	})

	runtime.OnCommand("relay", func(ctx *brickly.CommandContext, raw json.RawMessage) (any, error) {
		var input resourceInput
		if err := json.Unmarshal(raw, &input); err != nil {
			return nil, err
		}
		if input.TargetBrickID == "" {
			return nil, brickly.NewBppError("INVALID_INPUT", "targetBrickId is required")
		}
		if input.TargetCommandID == "" {
			input.TargetCommandID = "inspect"
		}
		var result any
		err := ctx.Invoke(input.TargetBrickID, input.TargetCommandID, map[string]any{"resource": input.Resource}, &result)
		return result, err
	})

	runtime.OnCommand("hold", func(ctx *brickly.CommandContext, raw json.RawMessage) (any, error) {
		input, handle, err := hydrateInput(ctx, raw)
		if err != nil {
			return nil, err
		}
		defer handle.Close()
		return inspectSlow(ctx, handle, input.Resource.MimeType, input.DelayMillis)
	})

	runtime.OnCommand("event-last", func(_ *brickly.CommandContext, _ json.RawMessage) (any, error) { return lastEvent, nil })
	runtime.Events.On("resource-lab:probe", func(payload any, _ brickly.EventEnvelope) {
		handle, ok := payload.(*brickly.ResourceHandle)
		if !ok {
			lastEvent = map[string]any{"runtime": "go", "errorCode": "INVALID_INPUT"}
			return
		}
		defer handle.Close()
		var value any
		if err := handle.JSON(&value); err != nil {
			lastEvent = map[string]any{"runtime": "go", "errorCode": "INTERNAL_ERROR"}
			return
		}
		lastEvent = map[string]any{"runtime": "go", "received": true, "payload": value}
	})
	runtime.Start()
}

func inspectReader(reader io.Reader, runtimeName, mimeType string, bufferBytes int) (inspectResult, error) {
	if bufferBytes <= 0 {
		bufferBytes = 64 * 1024
	}
	digest := sha256.New()
	buffer := make([]byte, bufferBytes)
	var sizeBytes, chunkCount int64
	for {
		n, err := reader.Read(buffer)
		if n > 0 {
			_, _ = digest.Write(buffer[:n])
			sizeBytes += int64(n)
			chunkCount++
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return inspectResult{}, err
		}
	}
	return inspectResult{Runtime: runtimeName, SizeBytes: sizeBytes, ChunkCount: chunkCount, SHA256: hex.EncodeToString(digest.Sum(nil)), MIMEType: mimeType}, nil
}

func inspectSlow(ctx *brickly.CommandContext, reader io.Reader, mimeType string, delayMillis int) (inspectResult, error) {
	if delayMillis <= 0 {
		delayMillis = 25
	}
	digest := sha256.New()
	buffer := make([]byte, 64*1024)
	var sizeBytes, chunks int64
	for {
		select {
		case <-ctx.Context().Done():
			return inspectResult{}, brickly.NewBppError("CANCELLED", "cancelled")
		default:
		}
		n, err := reader.Read(buffer)
		if n > 0 {
			_, _ = digest.Write(buffer[:n])
			sizeBytes += int64(n)
			chunks++
			time.Sleep(time.Duration(delayMillis) * time.Millisecond)
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return inspectResult{}, err
		}
	}
	return inspectResult{Runtime: "go", SizeBytes: sizeBytes, ChunkCount: chunks, SHA256: hex.EncodeToString(digest.Sum(nil)), MIMEType: mimeType}, nil
}

func hydrateInput(ctx *brickly.CommandContext, raw json.RawMessage) (resourceInput, *brickly.ResourceHandle, error) {
	var input resourceInput
	if err := json.Unmarshal(raw, &input); err != nil {
		return input, nil, err
	}
	handle, err := ctx.HydrateResource(input.Resource)
	return input, handle, err
}

func newPatternReader(sizeBytes int64, value byte) io.Reader {
	return &patternReader{remaining: sizeBytes, value: value}
}
func (r *patternReader) Read(buffer []byte) (int, error) {
	if r.remaining <= 0 {
		return 0, io.EOF
	}
	n := len(buffer)
	if int64(n) > r.remaining {
		n = int(r.remaining)
	}
	for i := 0; i < n; i++ {
		buffer[i] = r.value
	}
	r.remaining -= int64(n)
	return n, nil
}

type xorReader struct {
	source io.Reader
	mask   byte
}

func (r *xorReader) Read(buffer []byte) (int, error) {
	n, err := r.source.Read(buffer)
	for i := 0; i < n; i++ {
		buffer[i] ^= r.mask
	}
	return n, err
}
func defaultByte(value byte) byte {
	if value == 0 {
		return 0x61
	}
	return value
}
func defaultMask(value byte) byte {
	if value == 0 {
		return 0x20
	}
	return value
}
