param(
  [switch]$IncludeHostE2E,
  [switch]$IncludeLargeHostE2E,
  [string]$HostRoot = 'D:\brick-project\ai-bricks\Brickly'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$pythonCache = Join-Path $env:TEMP "brickly-resource-lab-pycache-$PID"
$npmCache = Join-Path $env:TEMP "brickly-resource-lab-npm-cache-$PID"
$goBuildCache = Join-Path $env:TEMP "brickly-resource-lab-go-build-$PID"

function Invoke-NativeStep {
  param([string]$Name, [string]$WorkingDirectory, [string]$Executable, [string[]]$Arguments)
  Write-Host "`n==> $Name" -ForegroundColor Cyan
  Push-Location $WorkingDirectory
  try {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
}

try {
  $env:PYTHONPYCACHEPREFIX = $pythonCache
  $env:npm_config_cache = $npmCache
  $env:GOCACHE = $goBuildCache
  $pythonExecutable = Join-Path $repoRoot 'com.brickly.resource-echo-python\.venv\Scripts\python.exe'
  if (-not (Test-Path -LiteralPath $pythonExecutable)) { $pythonExecutable = 'python' }
  Invoke-NativeStep 'Resource Lab Runtime dependencies' (Join-Path $repoRoot 'com.brickly.resource-lab\runtime\win-x64') 'npm.cmd' @('ci', '--ignore-scripts')
  Invoke-NativeStep 'Node Echo dependencies' (Join-Path $repoRoot 'com.brickly.resource-echo-node\runtime\win-x64') 'npm.cmd' @('ci', '--ignore-scripts')
  Invoke-NativeStep 'Resource Lab Runtime tests' (Join-Path $repoRoot 'com.brickly.resource-lab\runtime\win-x64') 'node.exe' @('--test', 'catalog.test.cjs', 'run-manager.test.cjs', 'scenarios.test.cjs', 'index.test.cjs')
  Invoke-NativeStep 'Node Echo tests' (Join-Path $repoRoot 'com.brickly.resource-echo-node\runtime\win-x64') 'node.exe' @('--test', 'operations.test.cjs', 'hold-registry.test.cjs', 'resource-input.test.cjs')
  Invoke-NativeStep 'Node Echo syntax' $repoRoot 'node.exe' @('--check', 'com.brickly.resource-echo-node/runtime/win-x64/index.cjs')
  Invoke-NativeStep 'Python Echo tests' $repoRoot $pythonExecutable @('-m', 'unittest', 'discover', '-s', 'com.brickly.resource-echo-python/runtime/win-x64', '-p', 'test_*.py')
  Invoke-NativeStep 'Python Echo syntax' $repoRoot $pythonExecutable @('-m', 'py_compile', 'com.brickly.resource-echo-python/runtime/win-x64/main.py', 'com.brickly.resource-echo-python/runtime/win-x64/resource_ops.py', 'com.brickly.resource-echo-python/runtime/win-x64/resource_input.py')
  Invoke-NativeStep 'Go Echo tests' (Join-Path $repoRoot 'com.brickly.resource-echo-go\runtime\go') 'go.exe' @('test', './...')
  Invoke-NativeStep 'Go Echo six-platform build' $repoRoot 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'com.brickly.resource-echo-go/runtime/go/build.ps1')

  $uiRoot = Join-Path $repoRoot 'com.brickly.resource-lab'
  Invoke-NativeStep 'Resource Lab UI dependencies' $uiRoot 'npm.cmd' @('ci', '--ignore-scripts')
  Invoke-NativeStep 'Resource Lab UI tests' $uiRoot 'npm.cmd' @('test')
  Invoke-NativeStep 'Resource Lab UI typecheck' $uiRoot 'npm.cmd' @('run', 'typecheck')
  Invoke-NativeStep 'Resource Lab UI build' $uiRoot 'npm.cmd' @('run', 'build')
  Invoke-NativeStep 'Resource Lab manifest schema' $repoRoot 'node.exe' @('scripts/validate-resource-lab-manifests.mjs')

  if ($IncludeHostE2E -or $IncludeLargeHostE2E) {
    if (-not (Test-Path (Join-Path $HostRoot 'package.json'))) { throw "Host repository not found: $HostRoot" }
    $env:BRICKLY_HOST_ROOT = $HostRoot
    Remove-Item Env:RESOURCE_LAB_E2E_IDS -ErrorAction SilentlyContinue
    $tsxCli = Join-Path $HostRoot 'node_modules\tsx\dist\cli.mjs'
    Invoke-NativeStep 'Resource Lab real Host E2E' $repoRoot 'node.exe' @($tsxCli, '--test', 'scripts/resource-lab-host-e2e.test.ts')
    if ($IncludeLargeHostE2E) {
      Invoke-NativeStep 'Brickly Host 201 MiB resource E2E' $HostRoot 'npm.cmd' @('run', 'test:e2e:resource:large')
    }
  }

  Invoke-NativeStep 'Git whitespace check' $repoRoot 'git.exe' @('diff', '--check')
  Write-Host "`nResource Lab acceptance passed." -ForegroundColor Green
} finally {
  Remove-Item Env:PYTHONPYCACHEPREFIX -ErrorAction SilentlyContinue
  Remove-Item Env:npm_config_cache -ErrorAction SilentlyContinue
  Remove-Item Env:GOCACHE -ErrorAction SilentlyContinue
  Remove-Item Env:BRICKLY_HOST_ROOT -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $pythonCache) { Remove-Item -LiteralPath $pythonCache -Recurse -Force }
  if (Test-Path -LiteralPath $npmCache) { Remove-Item -LiteralPath $npmCache -Recurse -Force }
  if (Test-Path -LiteralPath $goBuildCache) { Remove-Item -LiteralPath $goBuildCache -Recurse -Force }
}
