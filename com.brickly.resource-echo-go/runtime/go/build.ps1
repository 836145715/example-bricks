param([string[]]$Targets = @())

$ErrorActionPreference = 'Stop'
$matrix = @{
  'win-x64' = @('windows', 'amd64', '.exe')
  'win-arm64' = @('windows', 'arm64', '.exe')
  'mac-x64' = @('darwin', 'amd64', '')
  'mac-arm64' = @('darwin', 'arm64', '')
  'linux-x64' = @('linux', 'amd64', '')
  'linux-arm64' = @('linux', 'arm64', '')
}
if ($Targets.Count -eq 0) { $Targets = @($matrix.Keys | Sort-Object) }
$brickRoot = Resolve-Path "$PSScriptRoot\..\.."
Push-Location $PSScriptRoot
try {
  foreach ($target in $Targets) {
    if (-not $matrix.ContainsKey($target)) { throw "Unknown target: $target" }
    $goos, $goarch, $suffix = $matrix[$target]
    $outputDir = Join-Path $brickRoot "runtime\$target"
    New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
    $env:GOOS = $goos
    $env:GOARCH = $goarch
    $env:CGO_ENABLED = '0'
    go build -trimpath -ldflags '-s -w' -o (Join-Path $outputDir "brick$suffix") .
    if ($LASTEXITCODE -ne 0) { throw "go build failed for $target" }
  }
} finally {
  Pop-Location
  Remove-Item Env:GOOS, Env:GOARCH, Env:CGO_ENABLED -ErrorAction SilentlyContinue
}
