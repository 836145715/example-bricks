# 编译 Go 后端二进制 - Windows（disk-map 仅支持 macOS，此脚本仅为对齐目录结构保留）
param(
    [string]$Targets = "mac-arm64,mac-x64"
)
$ErrorActionPreference = "Stop"
$ROOT = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$SRC = $PSScriptRoot
$RUNTIME_ROOT = Join-Path $ROOT "runtime"
$STAMP = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

$MAP = @{
    "mac-arm64" = @{ GOOS = "darwin"; GOARCH = "arm64"; Suffix = "" }
    "mac-x64"   = @{ GOOS = "darwin"; GOARCH = "amd64"; Suffix = "" }
}

foreach ($key in $Targets.Split(",")) {
    $key = $key.Trim()
    if (-not $MAP.ContainsKey($key)) {
        Write-Error "Unknown target: $key (disk-map is macOS only)"
    }
    $t = $MAP[$key]
    $outDir = Join-Path $RUNTIME_ROOT $key
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    $outFile = Join-Path $outDir ("brick" + $t.Suffix)
    Write-Host "Building $key -> $outFile"
    Push-Location $SRC
    try {
        $env:GOOS = $t.GOOS
        $env:GOARCH = $t.GOARCH
        $env:CGO_ENABLED = "0"
        go build -trimpath -ldflags "-s -w -X main.buildStamp=$STAMP" -o $outFile .
    } finally {
        Pop-Location
    }
    Write-Host "  OK  $((Get-Item $outFile).Length) bytes"
}
Write-Host "Done."
