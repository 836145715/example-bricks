# Build Go Brick binaries for all supported platforms.
# Usage: powershell -File build.ps1 [-Targets win-x64,linux-x64,...]
# Default: only build for current host platform.

param(
  [string[]]$Targets = @()
)

$ErrorActionPreference = 'Stop'
$brickRoot = Resolve-Path "$PSScriptRoot\..\.."
$srcDir = "$PSScriptRoot"
$binRoot = "$brickRoot\bin"
$stamp = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")

# Map: brickly platform key -> (GOOS, GOARCH, exeSuffix)
$matrix = @{
  'win-x64'     = @('windows', 'amd64', '.exe')
  'win-arm64'   = @('windows', 'arm64', '.exe')
  'mac-x64'     = @('darwin',  'amd64', '')
  'mac-arm64'   = @('darwin',  'arm64', '')
  'linux-x64'   = @('linux',   'amd64', '')
  'linux-arm64' = @('linux',   'arm64', '')
}

# 默认只构建当前主机平台
if ($Targets.Count -eq 0) {
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $os = if ($IsWindows -or $env:OS -eq 'Windows_NT') { 'win' } elseif ($IsMacOS) { 'mac' } else { 'linux' }
  $Targets = @("$os-$arch")
}

Push-Location $srcDir
try {
  foreach ($key in $Targets) {
    if (-not $matrix.ContainsKey($key)) {
      Write-Warning "Unknown target: $key. Skipped."
      continue
    }
    $goos, $goarch, $suffix = $matrix[$key]
    $outDir = Join-Path $binRoot $key
    if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }
    $outFile = Join-Path $outDir "brick$suffix"

    Write-Host "Building $key -> $outFile" -ForegroundColor Cyan
    $env:GOOS = $goos
    $env:GOARCH = $goarch
    $env:CGO_ENABLED = '0'
    & go build -trimpath -ldflags "-s -w -X main.buildStamp=$stamp" -o $outFile .
    if ($LASTEXITCODE -ne 0) {
      throw "go build failed for $key (exit $LASTEXITCODE)"
    }
    $size = (Get-Item $outFile).Length
    Write-Host ("  OK  {0:N0} bytes" -f $size) -ForegroundColor Green
  }
}
finally {
  Pop-Location
  Remove-Item Env:GOOS, Env:GOARCH, Env:CGO_ENABLED -ErrorAction SilentlyContinue
}

Write-Host "Done." -ForegroundColor Green
