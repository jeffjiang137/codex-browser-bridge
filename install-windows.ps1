param(
  [switch]$ReplaceExistingMcp,
  [string]$UploadRoots = ""
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "[1/4] Installing production dependencies..."
npm install --omit=dev --no-audit --no-fund

$serverPath = Join-Path $PSScriptRoot "apps\mcp-server\dist\index.js"
$extensionPath = Join-Path $PSScriptRoot "apps\extension\dist"

if (-not (Test-Path -LiteralPath $serverPath -PathType Leaf)) {
  throw "MCP server runtime is missing: $serverPath"
}

if (-not (Test-Path -LiteralPath (Join-Path $extensionPath "manifest.json") -PathType Leaf)) {
  throw "Browser extension package is missing: $extensionPath"
}

Write-Host "[3/4] Checking Codex MCP registration..."
$existing = & codex mcp list 2>$null | Out-String
$hasExisting = $existing -match "browser_bridge"

if ($hasExisting -and $ReplaceExistingMcp) {
  Write-Host "Replacing existing browser_bridge registration..."
  & codex mcp remove browser_bridge
  $hasExisting = $false
}

if (-not $hasExisting) {
  if ([string]::IsNullOrWhiteSpace($UploadRoots)) {
    & codex mcp add browser_bridge -- node $serverPath
  } else {
    & codex mcp add browser_bridge --env "CODEX_BROWSER_BRIDGE_UPLOAD_ROOTS=$UploadRoots" -- node $serverPath
  }
} else {
  Write-Host "Codex MCP 'browser_bridge' already exists; registration was preserved."
  Write-Host "If this Phase 2 folder has a different path, rerun: .\install-windows.ps1 -ReplaceExistingMcp"
}

Write-Host "[4/4] Done."
Write-Host ""
Write-Host "Chrome extension folder: $extensionPath"
Write-Host "Open chrome://extensions -> Developer mode -> Load unpacked -> select that folder."
Write-Host "If an older unpacked Browser Bridge is already loaded, select Reload after rebuilding."
Write-Host "Restart Codex (or reload its MCP configuration) before testing new tools."
