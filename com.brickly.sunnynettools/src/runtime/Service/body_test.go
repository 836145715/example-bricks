package Service

import (
	"bytes"
	"errors"
	"testing"
)

var errBodyCreateFailed = errors.New("create failed")

func TestMaybeBodyPayloadTruncatesAlreadyHandledByCaller(t *testing.T) {
	CreateBodyResource = func(name string, data []byte) (any, error) {
		t.Fatal("preview should not create a resource")
		return nil, nil
	}
	t.Cleanup(func() { CreateBodyResource = nil })

	body := bytes.Repeat([]byte("a"), MaxBodyLength)
	got := maybeBodyPayload("n", false, body)
	b, ok := got.([]byte)
	if !ok {
		t.Fatalf("got %T", got)
	}
	if !bytes.Equal(b, body) {
		t.Fatal("preview payload should stay []byte")
	}
}

func TestMaybeBodyPayloadUsesResourceWhenGetAllExceedsLimit(t *testing.T) {
	CreateBodyResource = func(name string, data []byte) (any, error) {
		return map[string]any{
			"kind":       "brickly.resource",
			"resourceId": "r1",
			"sizeBytes":  len(data),
			"name":       name,
		}, nil
	}
	t.Cleanup(func() { CreateBodyResource = nil })

	body := bytes.Repeat([]byte("a"), MaxBodyLength+8)
	got := maybeBodyPayload("http-request-1", true, body)
	m, ok := got.(map[string]any)
	if !ok {
		t.Fatalf("got %T", got)
	}
	if m["kind"] != "brickly.resource" {
		t.Fatalf("kind=%v", m["kind"])
	}
	if m["resourceId"] != "r1" {
		t.Fatalf("resourceId=%v", m["resourceId"])
	}
}

func TestMaybeBodyPayloadSmallGetAllStaysBytes(t *testing.T) {
	CreateBodyResource = func(name string, data []byte) (any, error) {
		t.Fatal("small body should not create a resource")
		return nil, nil
	}
	t.Cleanup(func() { CreateBodyResource = nil })

	body := []byte("hello")
	got := maybeBodyPayload("n", true, body)
	b, ok := got.([]byte)
	if !ok || string(b) != "hello" {
		t.Fatalf("got %#v", got)
	}
}

func TestMaybeBodyPayloadFallsBackWhenCreateFails(t *testing.T) {
	CreateBodyResource = func(name string, data []byte) (any, error) {
		return nil, errBodyCreateFailed
	}
	t.Cleanup(func() { CreateBodyResource = nil })

	body := bytes.Repeat([]byte("a"), MaxBodyLength+1)
	got := maybeBodyPayload("n", true, body)
	b, ok := got.([]byte)
	if !ok || len(b) != len(body) {
		t.Fatalf("fallback got %#v", got)
	}
}
