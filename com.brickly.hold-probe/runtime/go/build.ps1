# Build Hold Probe Go runtime.
# Usage: powershell -File build.ps1 [-Targets win-x64,win-arm64,mac-x64,mac-arm64]

param(
  [string[]]$Targets = @()
)

$ErrorActionPreference = 'Stop'
$brickRoot = Resolve-Path "$PSScriptRoot\..\.."
$srcDir = "$PSScriptRoot"
$binRoot = "$brickRoot\bin"
$matrix = @{
  'win-x64'   = @('windows', 'amd64', '.exe')
  'win-arm64' = @('windows', 'arm64', '.exe')
  'mac-x64'   = @('darwin', 'amd64', '')
  'mac-arm64' = @('darwin', 'arm64', '')
}

if ($Targets.Count -eq 0) {
  $Targets = @('win-x64')
} elseif ($Targets.Count -eq 1 -and $Targets[0] -match ',') {
  $Targets = $Targets[0].Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
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
    & go build -trimpath -ldflags "-s -w" -o $outFile .
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
