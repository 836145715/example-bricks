package Service

import "changeme/Service/Config"

// 在 Brickly 运行时中没有真实的多窗口，CreateXxxWindow 只注册虚拟窗口，
// 由前端 shim 以浮层/内嵌页面的形式呈现（对应原版的独立 Wails 窗口）。

func newVirtualWindow(name string) {
	Config.AppList[name] = Config.NewAppWindow(name)
}

func CreateCertWindow()        { newVirtualWindow("Cert") }
func CreateReplaceWindow()     { newVirtualWindow("ReplaceBody") }
func CreateThemeWindow()       { newVirtualWindow("主题调色") }
func CreateOtherWindow()       { newVirtualWindow("其他窗口") }
func CreateDebugWindow()       { newVirtualWindow("调试工具") }
func CreateMainWindowVirtual() { newVirtualWindow("Main") }
