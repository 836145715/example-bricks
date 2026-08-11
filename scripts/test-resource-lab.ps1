param(
  [switch]$IncludeHostE2E,
  [switch]$IncludeLargeHostE2E,
  [string]$HostRoot = 'D:\brick-project\ai-bricks\Brickly'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$pythonCache = Join-Path $env:TEMP "brickly-resource-lab-pycache-$PID"

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
  Invoke-NativeStep 'Resource Lab Runtime dependencies' (Join-Path $repoRoot 'com.brickly.resource-lab\runtime\node') 'npm.cmd' @('ci', '--ignore-scripts')
  Invoke-NativeStep 'Node Echo dependencies' (Join-Path $repoRoot 'com.brickly.resource-echo-node\runtime\node') 'npm.cmd' @('ci', '--ignore-scripts')
  Invoke-NativeStep 'Resource Lab Runtime tests' (Join-Path $repoRoot 'com.brickly.resource-lab\runtime\node') 'node.exe' @('--test', 'catalog.test.cjs', 'run-manager.test.cjs', 'scenarios.test.cjs', 'index.test.cjs')
  Invoke-NativeStep 'Node Echo tests' (Join-Path $repoRoot 'com.brickly.resource-echo-node\runtime\node') 'node.exe' @('--test', 'operations.test.cjs', 'hold-registry.test.cjs')
  Invoke-NativeStep 'Node Echo syntax' $repoRoot 'node.exe' @('--check', 'com.brickly.resource-echo-node/runtime/node/index.cjs')
  Invoke-NativeStep 'Python Echo tests' $repoRoot 'python' @('-m', 'unittest', 'discover', '-s', 'com.brickly.resource-echo-python/runtime/python', '-p', 'test_*.py')
  Invoke-NativeStep 'Python Echo syntax' $repoRoot 'python' @('-m', 'py_compile', 'com.brickly.resource-echo-python/runtime/python/main.py', 'com.brickly.resource-echo-python/runtime/python/resource_ops.py')
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
  Remove-Item Env:BRICKLY_HOST_ROOT -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $pythonCache) { Remove-Item -LiteralPath $pythonCache -Recurse -Force }
}
