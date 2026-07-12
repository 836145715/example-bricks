module com.brickly.log-searcher

go 1.21

require (
	github.com/836145715/brickly-sdk-go v0.1.0
	golang.org/x/crypto v0.17.0
)

require golang.org/x/sys v0.15.0 // indirect

// 使用 monorepo 内带 Info/Warn/Error 结构化日志的 SDK
replace github.com/836145715/brickly-sdk-go => ../../../ai-bricks/Brickly/packages/brickly-sdk-go
