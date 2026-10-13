<#
.SYNOPSIS
  Runs the Django backend on Windows WITHOUT Docker: embedded Python 3.12 + waitress, serving the static
  front-end export (out\) and the API from one port.  The same environment variables will be used by the
  portable package's start.bat.

.DESCRIPTION
  PowerShell 5.1 compatible, ASCII-only source.
  1. Reads KEY=VALUE lines from the env file (default deploy\portable\.env.portable, see .env.portable.example).
     A variable already present in the process environment wins over the file; a key missing from both gets the
     default documented in .env.portable.example.
  2. manage.py check, manage.py migrate --check (only CHECKS; it never migrates or seeds), collectstatic.
  3. Starts waitress on <PORTABLE_HOST>:<PORTABLE_PORT> (default 127.0.0.1:8011) in the foreground; Ctrl+C stops it.

  Nothing here writes to the database.  Use -CheckOnly to stop after step 2.

.PARAMETER EnvFile
  Settings file.  Default: deploy\portable\.env.portable  (optional; the file may be absent)
.PARAMETER PythonDir
  Folder holding python.exe.  Default: <repo>\runtime\python (packaged layout), else the build cache
  <main-worktree>\local-data\runtime-cache\runtime-full\python (made by build-runtime.ps1).
.PARAMETER FrontendDir
  Static export to serve.  Default: <repo>\out
.PARAMETER CheckOnly
  Run the checks and collectstatic, then exit without starting the server.
.PARAMETER SkipCollectstatic
  Do not run collectstatic (backend\staticfiles must already be filled, or /admin has no CSS).
#>
[CmdletBinding()]
param(
  [string]$EnvFile,
  [string]$PythonDir,
  [string]$FrontendDir,
  [switch]$CheckOnly,
  [switch]$SkipCollectstatic
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$m) { Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) -ForegroundColor Cyan }

$here     = $PSScriptRoot
$repoRoot = [IO.Path]::GetFullPath((Join-Path $here '..\..'))
$backend  = Join-Path $repoRoot 'backend'
if (-not (Test-Path -LiteralPath (Join-Path $backend 'manage.py'))) { throw "manage.py not found in $backend" }

# ---- python.exe -----------------------------------------------------------------------------------
if (-not $PythonDir) {
  $candidates = New-Object System.Collections.ArrayList
  [void]$candidates.Add((Join-Path $repoRoot 'runtime\python'))
  try {
    Push-Location $here
    $common = (& git rev-parse --git-common-dir 2>$null)
    if ($LASTEXITCODE -eq 0 -and $common) {
      if (-not [IO.Path]::IsPathRooted($common)) { $common = Join-Path $here $common }
      $main = Split-Path ([IO.Path]::GetFullPath($common)) -Parent
      [void]$candidates.Add((Join-Path $main 'local-data\runtime-cache\runtime-full\python'))
    }
  } catch {} finally { Pop-Location }
  foreach ($c in $candidates) { if (Test-Path -LiteralPath (Join-Path $c 'python.exe')) { $PythonDir = $c; break } }
}
if (-not $PythonDir -or -not (Test-Path -LiteralPath (Join-Path $PythonDir 'python.exe'))) {
  throw "Embedded python not found. Run deploy\portable\build-runtime.ps1 or pass -PythonDir."
}
$python = Join-Path $PythonDir 'python.exe'

# ---- environment ----------------------------------------------------------------------------------
if (-not $EnvFile) { $EnvFile = Join-Path $here '.env.portable' }
$fromFile = 0
if (Test-Path -LiteralPath $EnvFile) {
  foreach ($line in [IO.File]::ReadAllLines($EnvFile)) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith('#')) { continue }
    $i = $t.IndexOf('=')
    if ($i -lt 1) { continue }
    $k = $t.Substring(0, $i).Trim()
    $v = $t.Substring($i + 1).Trim()
    if ($v.Length -ge 2 -and (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'")))) {
      $v = $v.Substring(1, $v.Length - 2)
    }
    # Process environment wins; an empty value in the file is "unset" (so the default below applies).
    if (-not [Environment]::GetEnvironmentVariable($k, 'Process') -and $v -ne '') {
      [Environment]::SetEnvironmentVariable($k, $v, 'Process'); $fromFile++
    }
  }
  Write-Host "  env file: $EnvFile ($fromFile values)"
} else {
  Write-Host "  env file not found ($EnvFile): using the process environment and defaults only"
}

function Set-Default([string]$name, [string]$value) {
  if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) { [Environment]::SetEnvironmentVariable($name, $value, 'Process') }
}
if (-not $FrontendDir) { $FrontendDir = Join-Path $repoRoot 'out' }

Set-Default 'DJANGO_SETTINGS_MODULE' 'config.settings.prod'
Set-Default 'DJANGO_ALLOWED_HOSTS' 'localhost,127.0.0.1'
Set-Default 'SESSION_COOKIE_SECURE' 'false'      # plain http on the workstation
Set-Default 'CSRF_COOKIE_SECURE' 'false'
Set-Default 'LDAP_ENABLED' 'false'
Set-Default 'FRONTEND_DIST_DIR' $FrontendDir
Set-Default 'PORTABLE_HOST' '127.0.0.1'
Set-Default 'PORTABLE_PORT' '8011'
# REDIS_URL stays empty: settings fall back to the in-process cache (the file's own REDIS_URL, if any, is kept).
if (-not [Environment]::GetEnvironmentVariable('DJANGO_SECRET_KEY', 'Process')) {
  $bytes = New-Object byte[] 48
  $rng = New-Object Security.Cryptography.RNGCryptoServiceProvider
  $rng.GetBytes($bytes); $rng.Dispose()
  $key = ([Convert]::ToBase64String($bytes) -replace '[+/=]', 'x')
  [Environment]::SetEnvironmentVariable('DJANGO_SECRET_KEY', $key, 'Process')
  Write-Host "  DJANGO_SECRET_KEY: generated for this run (sessions end when the server stops)"
}
if (-not [Environment]::GetEnvironmentVariable('DATABASE_URL', 'Process') -and -not [Environment]::GetEnvironmentVariable('DB_PASSWORD', 'Process')) {
  Write-Host "  WARNING: neither DATABASE_URL nor DB_PASSWORD is set; the database login will probably fail." -ForegroundColor Yellow
}
$bindHost = [Environment]::GetEnvironmentVariable('PORTABLE_HOST', 'Process')
$bindPort = [int][Environment]::GetEnvironmentVariable('PORTABLE_PORT', 'Process')
$dist = [Environment]::GetEnvironmentVariable('FRONTEND_DIST_DIR', 'Process')
if (-not (Test-Path -LiteralPath $dist)) { throw "Front-end export not found: $dist (npm run build:export, or set FRONTEND_DIST_DIR)" }

# The embedded python ignores PYTHONPATH and the current directory (python312._pth puts it in isolated mode), so
# even `python manage.py` cannot import `config`.  Every call therefore goes through a tiny -c launcher that puts the
# backend folder on sys.path first.
$managePy = "import sys, os, runpy; sys.path.insert(0, os.getcwd()); sys.argv = ['manage.py'] + sys.argv[1:]; " +
            "runpy.run_path('manage.py', run_name='__main__')"

# ---- checks ----------------------------------------------------------------------------------------
Push-Location $backend
try {
  Write-Step "manage.py check"
  & $python -c $managePy check
  if ($LASTEXITCODE -ne 0) { throw "manage.py check failed (exit $LASTEXITCODE)" }

  Write-Step "manage.py migrate --check (read only: nothing is migrated)"
  & $python -c $managePy migrate --check
  if ($LASTEXITCODE -ne 0) { throw "There are unapplied migrations or the database is unreachable (exit $LASTEXITCODE). This script never migrates." }

  if (-not $SkipCollectstatic) {
    Write-Step "manage.py collectstatic (admin CSS/JS -> backend\staticfiles)"
    & $python -c $managePy collectstatic --noinput
    if ($LASTEXITCODE -ne 0) { throw "collectstatic failed (exit $LASTEXITCODE)" }
  }

  if ($CheckOnly) { Write-Step "Checks passed (-CheckOnly): not starting the server"; return }

  # ---- serve ---------------------------------------------------------------------------------------
  Write-Step "waitress on http://${bindHost}:${bindPort}/  (Ctrl+C to stop)"
  $code = "import sys, os; sys.path.insert(0, os.getcwd()); " +
          "from waitress import serve; from config.wsgi import application; " +
          "serve(application, host=os.environ['PORTABLE_HOST'], port=int(os.environ['PORTABLE_PORT']), threads=8)"
  & $python -c $code
  if ($LASTEXITCODE -ne 0) { throw "waitress exited with code $LASTEXITCODE" }
} finally {
  Pop-Location
}
