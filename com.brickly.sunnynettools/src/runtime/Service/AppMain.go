package Service

import (
	"changeme/Service/Config"
	"changeme/Service/Tools"
	"changeme/Service/clipboard"
	"changeme/Service/mcp"
	"changeme/Welcome"
	"changeme/internal/core"
	"changeme/internal/engine"
	"changeme/internal/session"
	"fmt"
	"runtime"
	"time"

	"github.com/qtgolang/SunnyNet/Api"
	"github.com/qtgolang/SunnyNet/SunnyNet"
)

type AppMain struct {
	Core *core.Core
	app  *SunnyNet.Sunny
	Tools.ReplaceBody
	Tools.RequestCert
	Tools.ProxyWay
	Tools.HTTPSProto
	Tools.MustTcp
	Tools.BaseSettings
	Tools.Device
	Tools.ScriptLog
	Tools.AddCustomTools
}

func NewAppServer() *AppMain {
	c := core.New()
	A := newAppMain(c.Engine.Sunny())
	A.Core = c
	A.Core.Engine.SetCallbacks(engine.Callbacks{
		HTTP: A.httpCallback,
		TCP:  A.tcpCallback,
		WS:   A.wsCallback,
		UDP:  A.udpCallback,
	})
	return A
}

// McpFuncRes 获取 mcp 结果
func (g *AppMain) McpFuncRes(res mcp.McpMsg) {
	if mcp.MsgCallback != nil {
		mcp.MsgCallback(res)
	}
}

// GOOS 当前系统是否Windows
func (g *AppMain) GOOS() bool {
	defer func() {
		if err := recover(); err != nil {
			panic(err)
		}
	}()
	return runtime.GOOS == "windows"
}

// 检测系统代理
func (g *AppMain) statusProxy() {
	return
	for {
		time.Sleep(time.Second)
		//fmt.Println(gosysproxy.Status())
	}
}

// Start 启动
func (g *AppMain) Start() {
	defer func() {
		if err := recover(); err != nil {
			panic(err)
		}
	}()
	g.app.Start()
	if runtime.GOOS == "windows" {
		go Welcome.Stop()
	}
	g.IsStart = g.app.Error == nil
}

// GetError 获取错误信息
func (g *AppMain) GetError() string {
	defer func() {
		if err := recover(); err != nil {
			panic(err)
		}
	}()
	if g.app.Error == nil {
		return ""
	}
	return g.app.Error.Error()
}

func (g *AppMain) CallTools(name string, open bool, args string) {
	defer func() {
		if err := recover(); err != nil {
			fmt.Println("CallTools panic:", err)
		}
	}()
	Config.Publish("__tool", name, open, args)
}

func (g *AppMain) GoGetHex(data []byte) string {
	defer func() {
		if err := recover(); err != nil {
			panic(err)
		}
	}()
	return Session.GetHexAllSpaces(data)
}

// GetAllStream 获取ws,tcp,udp,全部Stream
func (g *AppMain) GetAllStream(Theology int) []Session.UpdateSocketStream {
	defer func() {
		if err := recover(); err != nil {
			panic(err)
		}
	}()
	var array []Session.UpdateSocketStream
	{
		stream := Session.GetAppSession(Theology)
		if stream != nil {
			lock.Lock()
			stream.RangeStream(func(val Session.AppStream) bool {
				array = append(array, val.ToUpdateStream(Theology, stream.GetStreamFilter()))
				return true
			})
			SetCurrentTheology(Theology)
			lock.Unlock()
		}
	}
	return array
}

// ClipboardReadAll 获取剪辑版内容,成功返回空字符串
func (g *AppMain) ClipboardReadAll() string {
	if PlatformClipboardRead != nil {
		if s, err := PlatformClipboardRead(); err == nil {
			return s
		}
	}
	return clipboard.ClipboardReadAll()
}
func (g *AppMain) ProtobufToJson(aa []byte, skip int) string {
	defer func() {
		if err := recover(); err != nil {
			panic(err)
		}
	}()
	if skip > len(aa) {
		return ""
	}
	return Api.PbToJson(aa[skip:])
}
