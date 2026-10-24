<#
  TradePilot AI — MT5 connector setup (Windows, no administrator rights needed).

  Run from this folder:
      powershell -ExecutionPolicy Bypass -File .\setup.ps1

  What it does:
    1. finds 64-bit Python 3.12 or 3.13 (the Python launcher "py" or python.exe);
    2. creates a private virtual environment in .venv\ (re-used on later runs);
    3. installs the pinned, hash-checked dependencies from requirements.txt;
    4. runs the connector's local diagnostic ("check").
  Re-running it after updating the TradePilot files updates the connector.
#>
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

function Find-Python {
  $probe = "import struct,sys;print(str(sys.version_info[0])+'.'+str(sys.version_info[1])+' '+str(struct.calcsize('P')*8))"
  $candidates = @(
    @{ Exe = 'py'; Extra = @('-3.12') },
    @{ Exe = 'py'; Extra = @('-3.13') },
    @{ Exe = 'python'; Extra = @() }
  )
  foreach ($c in $candidates) {
    if (-not (Get-Command $c.Exe -ErrorAction SilentlyContinue)) { continue }
    $extra = $c.Extra
    try { $info = & $c.Exe @extra -c $probe 2>$null } catch { continue }
    if ($LASTEXITCODE -ne 0 -or -not $info) { continue }
    $parts = "$info".Trim().Split(' ')
    if ((@('3.12', '3.13') -contains $parts[0]) -and ($parts[1] -eq '64')) { return $c }
  }
  return $null
}

Write-Host "TradePilot MT5 connector setup" -ForegroundColor Cyan
$python = Find-Python
if (-not $python) {
  Write-Host "64-bit Python 3.12 or 3.13 was not found." -ForegroundColor Red
  Write-Host "Install it from https://www.python.org/downloads/windows/ (tick 'Add python.exe to PATH'), then run this script again."
  exit 1
}
$pyExtra = $python.Extra
Write-Host "Using Python: $($python.Exe) $($pyExtra -join ' ')"

if (-not (Test-Path '.venv\Scripts\python.exe')) {
  Write-Host "Creating the virtual environment in .venv ..."
  & $python.Exe @pyExtra -m venv .venv
  if ($LASTEXITCODE -ne 0) { throw "Could not create the virtual environment." }
}

Write-Host "Installing pinned dependencies (hash-checked) ..."
& .\.venv\Scripts\python.exe -m pip install --disable-pip-version-check --require-hashes --only-binary=:all: -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed. Check your internet connection and try again." }

Write-Host ""
Write-Host "Running the local diagnostic ..." -ForegroundColor Cyan
& .\tradepilot-connector.cmd check
Write-Host ""
Write-Host "Setup finished. Next steps are in docs\mt5-connector.md (pair, then start)." -ForegroundColor Green
