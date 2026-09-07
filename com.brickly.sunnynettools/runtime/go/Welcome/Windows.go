//go:build windows
// +build windows

package Welcome

// Brickly 运行时不播欢迎动画、不自动提权。
// 原版会链入 Welcome/Windows 的 C++ GIF 播放器（gdiplus + libstdc++）。
// 在 Go 1.25 + CGO + ldflags -s 下，mingw 外链会打出 Windows 拒载的 PE
//（CreateProcess 193 / Node spawn EFTYPE）。这里只保留空实现。

func Start() {}

func Stop() {}
