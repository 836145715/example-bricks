package Service

import (
	"strconv"

	"changeme/internal/session"
)

// CreateBodyResource 由 main 注入：大包体走 SDK CreateResource，返回 ResourceRef。
var CreateBodyResource func(name string, data []byte) (any, error)

func httpBodyBytes(theology int, request, getAll bool) []byte {
	req := Session.GetHttpSession(theology)
	if req == nil {
		return nil
	}
	var body []byte
	if request {
		body = req.Request.Body
	} else {
		body = req.Response.Body
	}
	if !getAll && len(body) > MaxBodyLength {
		return body[:MaxBodyLength]
	}
	return body
}

func maybeBodyPayload(name string, getAll bool, body []byte) any {
	if getAll && len(body) > MaxBodyLength && CreateBodyResource != nil {
		ref, err := CreateBodyResource(name, body)
		if err == nil && ref != nil {
			return ref
		}
	}
	return body
}

func httpBodyPayload(theology int, request, getAll bool) any {
	kind := "http-response-"
	if request {
		kind = "http-request-"
	}
	body := httpBodyBytes(theology, request, getAll)
	return maybeBodyPayload(kind+strconv.Itoa(theology), getAll, body)
}
