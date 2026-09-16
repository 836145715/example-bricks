package Service

import "changeme/Service/Config"

// NotifyUI is injected from main.go (Config.Publish). Core packages must not call this.
var NotifyUI func(name string, args ...any)

func notify(name string, args ...any) {
	if NotifyUI != nil {
		NotifyUI(name, args...)
		return
	}
	Config.Publish(name, args...)
}
