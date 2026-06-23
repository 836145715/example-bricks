# Build Local Search Go runtime.
# Usage: powershell -File build.ps1 [-Targets win-x64]

param(
  [string[]]$Targets = @()
)

$ErrorActionPreference = 'Stop'
$brickRoot = Resolve-Path "$PSScriptRoot\..\.."
$srcDir = "$PSScriptRoot"
$binRoot = "$brickRoot\bin"
$stamp = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")

$matrix = @{
  'win-x64' = @('windows', 'amd64', '.exe')
}

if ($Targets.Count -eq 0) {
  $Targets = @('win-x64')
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
