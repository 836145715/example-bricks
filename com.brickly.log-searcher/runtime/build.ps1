# 编译 Go 后端二进制
$PSScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$srcDir = "$PSScriptRoot"
$binDir = "$PSScriptRoot\..\bin\win-x64"

if (-not (Test-Path $binDir)) {
    New-Item -ItemType Directory -Path $binDir | Out-Null
}

$outFile = "$binDir\brick.exe"
Write-Host "Building Go runtime for win-x64 -> $outFile" -ForegroundColor Cyan

$env:GOOS = "windows"
$env:GOARCH = "amd64"
$env:CGO_ENABLED = "0"

& go build -trimpath -ldflags "-s -w" -o $outFile .
if ($LASTEXITCODE -ne 0) {
    Write-Error "go build failed"
    exit 1
}

Write-Host "Build success. Size: $((Get-Item $outFile).Length) bytes" -ForegroundColor Green
