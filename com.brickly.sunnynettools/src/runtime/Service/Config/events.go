package Config

// EventPublisher 由 main.go 注入，把领域事件转成 brick 事件推给前端。
// window 仅作信封字段。工具 UI 走主界面页内弹层；BroadcastToolWindowEvent 只处理残留 OS 子窗。
var EventPublisher func(window string, name string, args []any)

// Publish 向主界面（及已打开的工具窗）推送具名事件。核心包禁止调用。
func Publish(name string, args ...any) {
	if EventPublisher != nil {
		EventPublisher("Main", name, args)
	}
}
