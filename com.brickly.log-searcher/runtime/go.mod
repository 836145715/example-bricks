module com.brickly.log-searcher

go 1.23

require (
	github.com/836145715/brickly-sdk-go v0.6.0
	golang.org/x/crypto v0.33.0
)

require (
	golang.org/x/net v0.35.0 // indirect
	golang.org/x/sys v0.30.0 // indirect
	golang.org/x/text v0.22.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20250218202821-56aae31c358a // indirect
	google.golang.org/grpc v1.72.2 // indirect
	google.golang.org/protobuf v1.36.11 // indirect
)

// 本地开发对齐 Brickly 现行 gRPC SDK；发布时改回模块版本。
replace github.com/836145715/brickly-sdk-go => ../../../ai-bricks/Brickly/packages/brickly-sdk-go
