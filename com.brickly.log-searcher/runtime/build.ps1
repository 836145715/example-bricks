# 编译 Go 后端二进制
$PSScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$srcDir = "$PSScriptRoot"
$binDir = "$PSScriptRoot\win-x64"

if (-not (Test-Path $binDir)) {
    New-Item -ItemType Directory -Path $binDir | Out-Null
}

$outFile = "$binDir\brick.exe"
Write-Host "Building Go runtime for win-x64 -> $outFile" -ForegroundColor Cyan

$env:GOOS = "windows"
$env:GOARCH = "amd64"
$env:CGO_ENABLED = "0"

Push-Location $srcDir
try {
    & go build -trimpath -ldflags "-s -w" -o $outFile .
    if ($LASTEXITCODE -ne 0) {
        throw "go build failed"
    }
}
finally {
    Pop-Location
    Remove-Item Env:GOOS, Env:GOARCH, Env:CGO_ENABLED -ErrorAction SilentlyContinue
}

Write-Host "Build success. Size: $((Get-Item $outFile).Length) bytes" -ForegroundColor Green
