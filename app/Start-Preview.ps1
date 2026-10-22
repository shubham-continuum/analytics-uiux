# Starts only the isolated Analyzer Studio preview on 127.0.0.1:8104.
$ErrorActionPreference = 'Stop'
$here = (Resolve-Path -LiteralPath (Split-Path -Parent $MyInvocation.MyCommand.Path)).Path
$port = 8104
$address = "http://127.0.0.1:$port"
try { $health = Invoke-RestMethod -Uri "$address/health" -TimeoutSec 2 } catch { $health = $null }
if ($health) {
  if ($health.app -eq 'gridsense-isolated-preview' -and $health.root -eq $here) {
    Write-Host "Already running: $address/analytics-analyzer-studio.html (pid $($health.pid))"
    exit 0
  }
  throw "Port $port is occupied by another service."
}

# WindowsApps python.exe is an alias launcher; use the actual interpreter for a durable process.
$pythonPath = (& python -c 'import sys; print(sys.executable)').Trim()
if (-not (Test-Path -LiteralPath $pythonPath)) { throw "Python interpreter not found: $pythonPath" }
$p = Start-Process -FilePath $pythonPath -ArgumentList @("`"$here\server.py`"", '--port', "$port") -WorkingDirectory $here -WindowStyle Hidden -PassThru
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 500
  try { $health = Invoke-RestMethod -Uri "$address/health" -TimeoutSec 1 } catch { $health = $null }
  if ($health -and $health.app -eq 'gridsense-isolated-preview' -and $health.root -eq $here) {
    Set-Content -LiteralPath "$here\preview.pid" -Value $health.pid
    Write-Host "Preview: $address/analytics-analyzer-studio.html (pid $($health.pid))"
    exit 0
  }
  if ($p.HasExited) { break }
}
throw 'Preview server did not become healthy on port 8104.'
