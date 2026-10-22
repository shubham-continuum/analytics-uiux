# Stops only this folder's preview server, verified by /health identity and root.
$ErrorActionPreference = 'Stop'
$here = (Resolve-Path -LiteralPath (Split-Path -Parent $MyInvocation.MyCommand.Path)).Path
$pidFile = "$here\preview.pid"
try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8104/health' -TimeoutSec 2 } catch { $health = $null }
if (-not $health) { Write-Host 'Preview is not running.'; exit 0 }
if ($health.app -ne 'gridsense-isolated-preview' -or $health.root -ne $here) {
  throw 'Port 8104 is occupied by a service that does not belong to this preview.'
}
Stop-Process -Id $health.pid -ErrorAction Stop
if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile }
Write-Host "Stopped preview (pid $($health.pid))"
