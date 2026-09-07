package Service

import (
	"testing"

	Session "changeme/internal/session"

	"github.com/qtgolang/SunnyNet/src/public"
)

func TestCaptureFlagsRoundTrip(t *testing.T) {
	captureClearAllFlags()
	t.Cleanup(captureClearAllFlags)

	captureSetFlags(42, 1, true)
	got := captureGetFlags(42)
	if got.BreakMode != 1 || !got.GuaranteeDisplay {
		t.Fatalf("got %+v", got)
	}

	captureMergeBreakMode(42, 2)
	got = captureGetFlags(42)
	if got.BreakMode != 2 || !got.GuaranteeDisplay {
		t.Fatalf("merge got %+v", got)
	}

	captureClearFlags(42)
	got = captureGetFlags(42)
	if got.BreakMode != 0 || got.GuaranteeDisplay {
		t.Fatalf("cleared %+v", got)
	}
}

func TestCaptureSummaryFailStatus(t *testing.T) {
	const theology = 9001
	req := Session.NewHttpSession()
	req.Theology = theology
	req.State = public.HttpRequestFail
	req.Ico = "error"
	req.Error = "连接 DNS解析的所有IP地址 都失败了"
	req.Request.Method = "POST"
	req.Request.Url = "https://chatgpt.com/ces/v1/rgstr"
	Session.Session.Store(theology, req)
	t.Cleanup(func() { Session.Session.Delete(theology) })

	row, ok := CaptureSummary(theology)
	if !ok {
		t.Fatal("missing summary")
	}
	if row["状态"] != "错误" {
		t.Fatalf("状态=%v want 错误", row["状态"])
	}
	if row["ico"] != "error" {
		t.Fatalf("ico=%v", row["ico"])
	}
}

func TestHttpSessionAlreadySucceeded(t *testing.T) {
	okReq := Session.NewHttpSession()
	okReq.State = public.HttpResponseOK
	okReq.Response.Code = "200"
	if !httpSessionAlreadySucceeded(okReq) {
		t.Fatal("200 OK should count as succeeded")
	}
	failReq := Session.NewHttpSession()
	failReq.State = public.HttpRequestFail
	failReq.Ico = "error"
	if httpSessionAlreadySucceeded(failReq) {
		t.Fatal("fail session should not count as succeeded")
	}
}
