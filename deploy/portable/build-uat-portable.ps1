<#
.SYNOPSIS
  Builds the portable ("green") UAT package qip-uat-portable-<yyyymmdd>.zip for colleagues' locked-down PCs:
  embedded Python 3.12 + Django/waitress serving the static front end + portable PostgreSQL 16 holding a copy of the
  development data.  No Node, no installer, no administrator rights on the target machine.

.DESCRIPTION
  PowerShell 5.1 compatible, ASCII-only source, re-runnable (the staging folder is rebuilt from scratch every run).
  Read-only towards the development database: the only thing done to it is `pg_dump` (through `docker compose exec`).

  Steps
    1. disk space check, commit/date for BUILD-INFO.txt
    2. stage runtime\python (from runtime-full, test packages removed), runtime\pgsql, app\web\out, app\backend, ...
    3. backend static files (collectstatic)
    4. database: initdb (random password) -> start -> restore the dev schema -> migrate --check -> uat_seed_testers
       (testers, demo reset, scrub) -> seed_admin --reset -> optional DavinciCase drop -> VACUUM -> stop
    5. app\backend\.env (random SECRET_KEY, the cluster password; no AD, no development secrets)
    6. start.bat, stop.bat, launcher.py, README-*.txt, BUILD-INFO.txt
    7. verify the staged tree is clean (no Excel, .env.prod, tests, venv, pytest), zip, SHA256

  The passwords of the testers, the demo accounts and admin are written to <OutDir>\uat-testers-passwords-<date>.md.
  That file is NOT part of the package.  Passwords are never printed.

.PARAMETER TestersCsv
  employee_id,full_name,roles,campus,assignments  (see apps/accounts/management/commands/uat_seed_testers.py).
  Default: <main-worktree>\local-data\uat-testers.csv ; when that default file does not exist the package only gets
  admin + the demo accounts.  A path given explicitly must exist.
.PARAMETER AdminPassword
  Initial password of the admin account (first login forces a change).  Default: random, written to the passwords file.
.PARAMETER DropDavinciCases
  Empty davinci_cases (case level, masked chart numbers) before packaging; the monthly aggregate table stays.
.PARAMETER OutDir
  Default: <main-worktree>\local-data\uat
.PARAMETER CacheDir
  Default: <main-worktree>\local-data\runtime-cache  (needs runtime-full\ from build-runtime.ps1 and the cached PostgreSQL zip)
.PARAMETER MainTree
  The main working tree (its docker compose runs the development PostgreSQL).  Default: derived from git.
.PARAMETER RebuildFrontend
  Force `npm run build:export` even when out\ looks up to date.
.PARAMETER Clean
  Delete the staging folder after the zip is written.
.PARAMETER MinFreeGB
  Stop when the drive has less free space than this (default 15).
#>
[CmdletBinding()]
param(
  [string]$TestersCsv,
  [string]$AdminPassword,
  [switch]$DropDavinciCases,
  [string]$OutDir,
  [string]$CacheDir,
  [string]$MainTree,
  [switch]$RebuildFrontend,
  [switch]$Clean,
  [int]$MinFreeGB = 15
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

# Same pin as build-probe.ps1
$PgVersion = '16.15-5'
$PgFile    = "postgresql-$PgVersion-windows-x64-binaries.zip"
$PgSha256  = '43bb45f173a6f08cf1d29a97a6d8deb119e8e8093a24c00d2d1001a0ccaa8281'

$PgRunPort = 5499   # the port start.bat gives PostgreSQL in the package (written into .env)
$PackageTestPackages = @('pytest', '_pytest', 'pytest_django', 'pluggy', 'iniconfig', 'pygments', 'py.py')

# ----------------------------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------------------------
function Write-Step([string]$m) { Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) -ForegroundColor Cyan }
function Get-Sha256([string]$path) { (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLower() }
function Get-FreeGB([string]$path) {
  $root = [IO.Path]::GetPathRoot((Resolve-Path $path).Path)
  return [math]::Round((New-Object IO.DriveInfo($root)).AvailableFreeSpace / 1GB, 1)
}
function Get-DirSizeMB([string]$p) {
  $s = (Get-ChildItem -LiteralPath $p -Recurse -File -Force | Measure-Object Length -Sum).Sum
  return [math]::Round($s / 1MB, 1)
}

function New-RandomString([int]$length, [string]$alphabet) {
  $bytes = New-Object byte[] ($length * 4)
  $rng = New-Object Security.Cryptography.RNGCryptoServiceProvider
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $sb = New-Object Text.StringBuilder
  for ($i = 0; $i -lt $length; $i++) {
    $n = [BitConverter]::ToUInt32($bytes, $i * 4)
    [void]$sb.Append($alphabet[[int]($n % $alphabet.Length)])
  }
  return $sb.ToString()
}
$Alnum = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

function New-AdminPassword {
  # 16 chars with all four classes (the password rules want length >= 10 and not too common); shuffled with a crypto seed
  $pw = (New-RandomString 3 'ABCDEFGHJKLMNPQRSTUVWXYZ') + (New-RandomString 3 'abcdefghijkmnopqrstuvwxyz') +
        (New-RandomString 4 '23456789') + (New-RandomString 2 '!@#%*-_=+?') + (New-RandomString 4 $Alnum)
  $chars = $pw.ToCharArray()
  $seed = New-Object byte[] 4
  $rng = New-Object Security.Cryptography.RNGCryptoServiceProvider; $rng.GetBytes($seed); $rng.Dispose()
  $rnd = New-Object Random ([BitConverter]::ToInt32($seed, 0))
  for ($i = $chars.Length - 1; $i -gt 0; $i--) { $j = $rnd.Next($i + 1); $t = $chars[$i]; $chars[$i] = $chars[$j]; $chars[$j] = $t }
  return (-join $chars)
}

function Quote-Arg([string]$a) {
  if ($a -eq '') { return '""' }
  if ($a -notmatch '[\s"]') { return $a }
  return '"' + ($a -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

# Run a program without redirecting anything (output goes to the console; nothing is held open by children that
# outlive it, e.g. the postmaster started by pg_ctl).  Returns the exit code.
function Invoke-Native([string]$exe, [string[]]$argList, [hashtable]$envVars, [string]$rawArguments) {
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $exe
  if ($rawArguments) { $psi.Arguments = $rawArguments } else { $psi.Arguments = (($argList | ForEach-Object { Quote-Arg $_ }) -join ' ') }
  $psi.UseShellExecute = $false
  if ($envVars) { foreach ($k in $envVars.Keys) { $psi.EnvironmentVariables[$k] = [string]$envVars[$k] } }
  $p = [Diagnostics.Process]::Start($psi)
  $p.WaitForExit()
  $code = $p.ExitCode
  $p.Dispose()
  return $code
}

# Run a program and capture stdout/stderr (for short-lived commands only).
function Invoke-Capture([string]$exe, [string[]]$argList, [hashtable]$envVars, [string]$workDir) {
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $exe
  $psi.Arguments = (($argList | ForEach-Object { Quote-Arg $_ }) -join ' ')
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = [Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [Text.Encoding]::UTF8
  $psi.CreateNoWindow = $true
  if ($workDir) { $psi.WorkingDirectory = $workDir }
  if ($envVars) { foreach ($k in $envVars.Keys) { $psi.EnvironmentVariables[$k] = [string]$envVars[$k] } }
  $p = [Diagnostics.Process]::Start($psi)
  $errTask = $p.StandardError.ReadToEndAsync()
  $out = $p.StandardOutput.ReadToEnd()
  $p.WaitForExit()
  $res = [pscustomobject]@{ Code = $p.ExitCode; Out = $out; Err = $errTask.Result }
  $p.Dispose()
  return $res
}

# robocopy wrapper: exit codes 0-7 are success.
function Copy-Tree([string]$src, [string]$dst, [string[]]$extra) {
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  $a = @($src, $dst, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1') + $extra
  $code = Invoke-Native 'robocopy.exe' $a $null
  if ($code -ge 8) { throw "robocopy failed ($code): $src -> $dst" }
}

function Expand-ZipSafe([string]$zipPath, [string]$destDir, [string[]]$prefixes, [string]$stripPrefix) {
  $destFull = [IO.Path]::GetFullPath($destDir)
  if (-not $destFull.EndsWith('\')) { $destFull += '\' }
  New-Item -ItemType Directory -Force -Path $destFull | Out-Null
  $zip = [IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    foreach ($e in $zip.Entries) {
      $n = $e.FullName
      if ($prefixes -and -not ($prefixes | Where-Object { $n.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) })) { continue }
      if ($stripPrefix -and $n.StartsWith($stripPrefix, [StringComparison]::OrdinalIgnoreCase)) { $n = $n.Substring($stripPrefix.Length) }
      if (-not $n) { continue }
      $target = [IO.Path]::GetFullPath((Join-Path $destFull ($n -replace '/', '\')))
      if (-not $target.StartsWith($destFull, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe zip entry: $($e.FullName)" }
      if ($n.EndsWith('/')) { New-Item -ItemType Directory -Force -Path $target | Out-Null; continue }
      New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
      [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $target, $true)
    }
  } finally { $zip.Dispose() }
}

function Write-TextFile([string]$path, [string]$text, [bool]$bom, [bool]$crlf) {
  if ($crlf) { $text = ($text -replace "`r`n", "`n") -replace "`n", "`r`n" }
  $enc = New-Object Text.UTF8Encoding($bom)
  if (-not $bom -and $text -notmatch '[^\x00-\x7F]') { $enc = New-Object Text.ASCIIEncoding }
  [IO.File]::WriteAllText($path, $text, $enc)
}

function Test-PortFree([int]$port) {
  $l = $null
  try { $l = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Parse('127.0.0.1'), $port); $l.Start(); return $true }
  catch { return $false } finally { if ($l) { $l.Stop() } }
}

# ----------------------------------------------------------------------------------------------
# paths
# ----------------------------------------------------------------------------------------------
$here     = $PSScriptRoot
$repoRoot = [IO.Path]::GetFullPath((Join-Path $here '..\..'))
$mainTree = $MainTree
if (-not $mainTree) {
  $common = $null
  try {
    Push-Location $here
    $common = (& git rev-parse --git-common-dir 2>$null)
    if ($LASTEXITCODE -eq 0 -and $common) {
      if (-not [IO.Path]::IsPathRooted($common)) { $common = Join-Path $here $common }
      $mainTree = Split-Path ([IO.Path]::GetFullPath($common)) -Parent
    }
  } catch {} finally { Pop-Location }
  if (-not $mainTree) { $mainTree = $repoRoot }
}
$localData = Join-Path $mainTree 'local-data'
if (-not $CacheDir) { $CacheDir = Join-Path $localData 'runtime-cache' }
if (-not $OutDir)   { $OutDir   = Join-Path $localData 'uat' }
$csvExplicit = [bool]$TestersCsv
if (-not $TestersCsv) { $TestersCsv = Join-Path $localData 'uat-testers.csv' }
New-Item -ItemType Directory -Force -Path $CacheDir, $OutDir | Out-Null

$stamp     = Get-Date -Format 'yyyyMMdd'
$pkgName   = "qip-uat-portable-$stamp"
$stageRoot = Join-Path $CacheDir 'stage-uat'
$pack      = Join-Path $stageRoot $pkgName
$passFile  = Join-Path $OutDir "uat-testers-passwords-$stamp.md"
$zipPath   = Join-Path $OutDir "$pkgName.zip"
$runtimeFull = Join-Path $CacheDir 'runtime-full\python'
$pgZip     = Join-Path $CacheDir $PgFile
$pgTrimmed = Join-Path $CacheDir 'pgsql-trimmed'

$buildStart = Get-Date

# ----------------------------------------------------------------------------------------------
# 1. checks
# ----------------------------------------------------------------------------------------------
$free0 = Get-FreeGB $CacheDir
Write-Step "Free space: $free0 GB (minimum $MinFreeGB GB)"
if ($free0 -lt $MinFreeGB) { throw "Only $free0 GB free; need at least $MinFreeGB GB. Stopping." }
if (-not (Test-Path -LiteralPath (Join-Path $runtimeFull 'python.exe'))) { throw "Embedded runtime missing: run deploy\portable\build-runtime.ps1 first ($runtimeFull)" }
if (-not (Test-Path -LiteralPath $pgZip)) { throw "PostgreSQL zip missing from the cache: $pgZip (run build-probe.ps1 once; nothing is downloaded here)" }
if ($csvExplicit -and -not (Test-Path -LiteralPath $TestersCsv)) { throw "-TestersCsv not found: $TestersCsv" }
$haveCsv = Test-Path -LiteralPath $TestersCsv
if (-not $haveCsv) { Write-Host "  no tester list ($TestersCsv): the package gets admin, the uat_* role accounts and the demo accounts only" -ForegroundColor Yellow }

$gitHash = 'unknown'; $gitDirty = ''
try {
  Push-Location $repoRoot
  $gitHash = (& git rev-parse --short HEAD).Trim()
  $dirtyLines = @(& git status --porcelain)
  if ($dirtyLines.Count -gt 0) { $gitDirty = " (+ $($dirtyLines.Count) uncommitted change(s))" }
} finally { Pop-Location }
Write-Host "  commit $gitHash$gitDirty ; package $pkgName"

# development PostgreSQL: names only (never the password), read from the main tree's backend\.env
$devEnvFile = Join-Path $mainTree 'backend\.env'
$devDb = 'qm_center'; $devUser = 'qm_admin'; $devSchema = 'qip'
if (Test-Path -LiteralPath $devEnvFile) {
  foreach ($line in [IO.File]::ReadAllLines($devEnvFile)) {
    if ($line -match '^\s*DB_NAME\s*=\s*(\S+)')   { $devDb = $Matches[1] }
    if ($line -match '^\s*DB_USER\s*=\s*(\S+)')   { $devUser = $Matches[1] }
    if ($line -match '^\s*DB_SCHEMA\s*=\s*(\S+)') { $devSchema = $Matches[1] }
  }
}
Write-Host "  development database: $devDb / schema $devSchema (read-only pg_dump through docker compose)"

# Process environment hygiene: only what this script sets may reach Django.
foreach ($k in 'DATABASE_URL','DB_HOST','DB_PORT','DB_NAME','DB_USER','DB_PASSWORD','DB_SCHEMA','REDIS_URL','DJANGO_SECRET_KEY',
               'DJANGO_ALLOWED_HOSTS','SEED_ADMIN_PASSWORD','FRONTEND_DIST_DIR','LDAP_ENABLED','PGPASSWORD','DJANGO_SETTINGS_MODULE') {
  [Environment]::SetEnvironmentVariable($k, $null, 'Process')
}

# ----------------------------------------------------------------------------------------------
# front end (npm run build:export) when out\ is missing or older than the last front-end commit
# ----------------------------------------------------------------------------------------------
$outDirWeb = Join-Path $repoRoot 'out'
$needBuild = $RebuildFrontend.IsPresent
$outIndex = Join-Path $outDirWeb 'index.html'
if (-not (Test-Path -LiteralPath $outIndex)) { $needBuild = $true }
else {
  try {
    Push-Location $repoRoot
    $ct = (& git log -1 --format=%ct -- app components lib next.config.mjs package.json package-lock.json scripts tailwind.config.ts postcss.config.mjs tsconfig.json public)
    Pop-Location
    if ($ct) {
      $commitTime = [DateTimeOffset]::FromUnixTimeSeconds([int64]$ct).LocalDateTime
      if ((Get-Item -LiteralPath $outIndex).LastWriteTime -lt $commitTime) { $needBuild = $true; Write-Host "  out\ is older than the last front-end commit ($commitTime)" }
    }
  } catch { Pop-Location }
}
if ($needBuild) {
  Write-Step "npm run build:export"
  if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'node_modules'))) { throw "node_modules missing in $repoRoot (npm ci first)" }
  Push-Location $repoRoot
  try {
    $code = Invoke-Native 'cmd.exe' @('/d', '/c', 'npm run build:export') $null
    if ($code -ne 0) { throw "npm run build:export failed ($code)" }
  } finally { Pop-Location }
  $free1 = Get-FreeGB $CacheDir
  Write-Host "  free space after the front-end build: $free1 GB"
  if ($free1 -lt $MinFreeGB) { throw "Only $free1 GB free after the build; stopping (minimum $MinFreeGB GB)." }
} else {
  Write-Host "  out\ is up to date: not rebuilding"
}
if (-not (Test-Path -LiteralPath $outIndex)) { throw "Front-end export missing: $outDirWeb" }

# ----------------------------------------------------------------------------------------------
# 2. staging
# ----------------------------------------------------------------------------------------------
Write-Step "Staging $pack"
if (Test-Path -LiteralPath $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $pack | Out-Null

# PostgreSQL: trimmed copy of the pinned EDB zip, cached next to the zip
$marker = Join-Path $pgTrimmed '.source-sha256'
if (-not ((Test-Path -LiteralPath $marker) -and ([IO.File]::ReadAllText($marker).Trim() -eq $PgSha256))) {
  Write-Step "Trimming PostgreSQL $PgVersion from the cached zip (once)"
  $h = Get-Sha256 $pgZip
  if ($h -ne $PgSha256) { throw "$PgFile has SHA256 $h but the pin is $PgSha256" }
  if (Test-Path -LiteralPath $pgTrimmed) { Remove-Item -LiteralPath $pgTrimmed -Recurse -Force }
  Expand-ZipSafe $pgZip $pgTrimmed @('pgsql/bin/', 'pgsql/lib/', 'pgsql/share/') 'pgsql/'
  Get-ChildItem -LiteralPath (Join-Path $pgTrimmed 'bin') -File | Where-Object {
    $_.Name -ieq 'stackbuilder.exe' -or $_.Name -like 'wx*.dll' -or $_.Extension -ieq '.lib' -or
    $_.Name -match '^(pg_isolation_regress|pg_regress|pg_regress_ecpg|isolationtester|test_cloexec|testplug|libpq_pipeline|libpq_testclient|libpq_uri_regress|pgbench|ecpg)\.(exe|dll)$'
  } | Remove-Item -Force
  Get-ChildItem -LiteralPath (Join-Path $pgTrimmed 'lib') -File -Filter '*.lib' | Remove-Item -Force
  foreach ($must in 'bin\postgres.exe', 'bin\initdb.exe', 'bin\pg_ctl.exe', 'bin\psql.exe', 'bin\pg_restore.exe', 'share\postgres.bki') {
    if (-not (Test-Path -LiteralPath (Join-Path $pgTrimmed $must))) { throw "PostgreSQL trim lost $must" }
  }
  [IO.File]::WriteAllText($marker, $PgSha256)
}
$pgDir = Join-Path $pack 'runtime\pgsql'
Copy-Tree $pgTrimmed $pgDir @('/XF', '.source-sha256')

# Python runtime: copy, then drop the test packages
$pyDir = Join-Path $pack 'runtime\python'
Copy-Tree $runtimeFull $pyDir @('/XD', '__pycache__')
$sp = Join-Path $pyDir 'Lib\site-packages'
foreach ($name in $PackageTestPackages) {
  $p = Join-Path $sp $name
  if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force }
}
Get-ChildItem -LiteralPath $sp -Directory -Filter '*.dist-info' | Where-Object { $_.Name -match '^(pytest|pytest_django|pluggy|iniconfig|pygments)-' } | Remove-Item -Recurse -Force
# third-party test folders (numpy, axes, ...) are dead weight and would hide real leaks from the final check
$testDirs = @(Get-ChildItem -LiteralPath $sp -Recurse -Directory -Force | Where-Object { $_.Name -eq 'tests' } | Sort-Object { $_.FullName.Length } -Descending)
foreach ($d in $testDirs) { if (Test-Path -LiteralPath $d.FullName) { Remove-Item -LiteralPath $d.FullName -Recurse -Force } }
Write-Host "  removed $($testDirs.Count) third-party tests folders from site-packages"
foreach ($bad in 'pytest', 'pytest_django', '_pytest', 'pluggy', 'iniconfig') {
  if (Test-Path -LiteralPath (Join-Path $sp $bad)) { throw "test package $bad is still in the runtime" }
}

# front end
$webOut = Join-Path $pack 'app\web\out'
Copy-Tree $outDirWeb $webOut @('/XF', '*.xls', '*.xlsx', '*.xlsm', '*.csv', '*.map')

# backend (no venv / tests / env files / caches / staticfiles; collectstatic regenerates the latter)
$backendSrc = Join-Path $repoRoot 'backend'
$backend = Join-Path $pack 'app\backend'
Copy-Tree $backendSrc $backend @('/XD', 'venv', '.venv', 'tests', '__pycache__', 'staticfiles', 'media', '.pytest_cache',
                                  '/XF', '.env', '.env.*', '*.pyc', 'conftest.py', 'Dockerfile', '.dockerignore', 'entrypoint.sh',
                                  'requirements.txt', 'requirements-dev.txt', 'init-db.sql', '.gitignore', 'pyproject.toml')
Copy-Item -LiteralPath (Join-Path $here 'launcher.py') -Destination (Join-Path $pack 'app\launcher.py')
New-Item -ItemType Directory -Force -Path (Join-Path $pack 'data\media'), (Join-Path $pack 'logs') | Out-Null
$sizePy = Get-DirSizeMB $pyDir
Write-Host "  runtime\python $sizePy MB ; runtime\pgsql $(Get-DirSizeMB $pgDir) MB ; app\web\out $(Get-DirSizeMB $webOut) MB ; app\backend $(Get-DirSizeMB $backend) MB"

# ----------------------------------------------------------------------------------------------
# 5 (early). app\backend\.env : needed by collectstatic and by the later Django calls
# ----------------------------------------------------------------------------------------------
$dbPassword = New-RandomString 32 $Alnum
$secretKey  = New-RandomString 60 $Alnum
$envText = @"
# Generated by build-uat-portable.ps1 for this package only. No AD settings, no development secrets.
DJANGO_SETTINGS_MODULE=config.settings.prod
DJANGO_SECRET_KEY=$secretKey
DJANGO_DEBUG=false
DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost
SESSION_COOKIE_SECURE=false
CSRF_COOKIE_SECURE=false
DATABASE_URL=postgresql://qip:$dbPassword@127.0.0.1:$PgRunPort/qip
DB_SCHEMA=qip
REDIS_URL=
LDAP_ENABLED=false
DASHBOARD_CACHE_ENABLED=false
# Static files are collected into app\backend\staticfiles (the settings' default STATIC_ROOT).
# FRONTEND_DIST_DIR is set to the absolute app\web\out path by start.bat / launcher.py.
"@
$envPath = Join-Path $backend '.env'
Write-TextFile $envPath $envText $false $true

$python   = Join-Path $pyDir 'python.exe'
$launcher = Join-Path $pack 'app\launcher.py'
$baseEnv  = @{ 'DJANGO_SETTINGS_MODULE' = 'config.settings.prod'; 'FRONTEND_DIST_DIR' = $webOut; 'PYTHONDONTWRITEBYTECODE' = '1' }

function Invoke-Manage([string[]]$manageArgs, [hashtable]$extraEnv, [switch]$AllowFail) {
  $e = @{}; foreach ($k in $baseEnv.Keys) { $e[$k] = $baseEnv[$k] }
  if ($extraEnv) { foreach ($k in $extraEnv.Keys) { $e[$k] = $extraEnv[$k] } }
  $r = Invoke-Capture $python (@('-X', 'utf8', $launcher, 'manage') + $manageArgs) $e $null
  if ($r.Code -ne 0 -and -not $AllowFail) {
    Write-Host $r.Out; Write-Host $r.Err
    throw "manage.py $($manageArgs -join ' ') failed (exit $($r.Code))"
  }
  return $r
}

# ----------------------------------------------------------------------------------------------
# 3. static files + check
# ----------------------------------------------------------------------------------------------
Write-Step "manage.py check, collectstatic"
$r = Invoke-Manage @('check')
Write-Host "  check: $($r.Out.Trim())"
$r = Invoke-Manage @('collectstatic', '--noinput')
Write-Host "  collectstatic: $((($r.Out -split "`n") | Where-Object { $_.Trim() } | Select-Object -Last 1).Trim())"

# ----------------------------------------------------------------------------------------------
# 4. database
# ----------------------------------------------------------------------------------------------
Write-Step "PostgreSQL cluster"
$pgBin   = Join-Path $pgDir 'bin'
$pgData  = Join-Path $pack 'data\pgdata'
$buildPgLog = Join-Path $stageRoot 'build-postgres.log'
$pwFile  = Join-Path $stageRoot 'pg.pw'
[IO.File]::WriteAllText($pwFile, $dbPassword, (New-Object Text.ASCIIEncoding))
try {
  $code = Invoke-Native (Join-Path $pgBin 'initdb.exe') @('-D', $pgData, '-U', 'qip', '-A', 'scram-sha-256', '--pwfile', $pwFile, '-E', 'UTF8', '--no-locale') $null
  if ($code -ne 0) { throw "initdb failed ($code)" }
} finally { if (Test-Path -LiteralPath $pwFile) { Remove-Item -LiteralPath $pwFile -Force } }

# modest settings for a colleague's PC; the port in the file is the package's runtime port
$conf = @"

# --- QIP UAT portable ---
listen_addresses = '127.0.0.1'
port = $PgRunPort
max_connections = 40
shared_buffers = 64MB
min_wal_size = 32MB
max_wal_size = 128MB
"@
[IO.File]::AppendAllText((Join-Path $pgData 'postgresql.conf'), $conf, (New-Object Text.ASCIIEncoding))

# the build-time server may use another port when 5499 is busy; the .env always says 5499
$buildPort = $PgRunPort
if (-not (Test-PortFree $buildPort)) { $buildPort = 5498; Write-Host "  port $PgRunPort busy: building on $buildPort (recorded; the package still runs on $PgRunPort)" -ForegroundColor Yellow }
if (-not (Test-PortFree $buildPort)) { throw "ports $PgRunPort and 5498 are both busy" }

$pgctl = Join-Path $pgBin 'pg_ctl.exe'
$psql  = Join-Path $pgBin 'psql.exe'
$pgEnv = @{ 'PGPASSWORD' = $dbPassword; 'PGCLIENTENCODING' = 'UTF8' }
$buildDbUrl = "postgresql://qip:$dbPassword@127.0.0.1:$buildPort/qip"
$pgStarted = $false
$dumpFile = Join-Path $stageRoot 'dev.dump'
try {
  $code = Invoke-Native $pgctl @('-D', $pgData, '-o', "-p $buildPort -h 127.0.0.1", '-l', $buildPgLog, '-w', '-t', '90', 'start') $null
  if ($code -ne 0) { throw "pg_ctl start failed ($code); see $buildPgLog" }
  $pgStarted = $true

  function Invoke-Psql([string]$db, [string]$sql) {
    $r = Invoke-Capture $psql @('-h', '127.0.0.1', '-p', "$buildPort", '-U', 'qip', '-d', $db, '-v', 'ON_ERROR_STOP=1', '-At', '-c', $sql) $pgEnv $null
    if ($r.Code -ne 0) { throw "psql failed: $($r.Err)" }
    return $r.Out.Trim()
  }

  Invoke-Psql 'postgres' "CREATE DATABASE qip ENCODING 'UTF8' TEMPLATE template0" | Out-Null
  # No pre-created schema: the dump of schema "$devSchema" carries its own CREATE SCHEMA (init-db.sql does the same job
  # for the Docker database).

  # ---- dump the development database (read only) -------------------------------------------------
  Write-Step "pg_dump of the development database (schema $devSchema, read only)"
  if ($devSchema -ne 'qip') { throw "Development DB_SCHEMA is '$devSchema'; the package expects 'qip'." }
  $dumpCmd = "cd /d `"$mainTree`" && docker compose exec -T postgres pg_dump -U $devUser -d $devDb --schema=$devSchema --no-owner --no-privileges -Fc > `"$dumpFile`""
  $code = Invoke-Native 'cmd.exe' $null $null ('/d /s /c "' + $dumpCmd + '"')
  if ($code -ne 0 -or -not (Test-Path -LiteralPath $dumpFile) -or (Get-Item -LiteralPath $dumpFile).Length -lt 1024) {
    throw "pg_dump through docker compose failed (exit $code). Is the development stack up (docker compose up -d postgres in $mainTree)?"
  }
  Write-Host ("  dump: {0:N1} MB" -f ((Get-Item -LiteralPath $dumpFile).Length / 1MB))

  Write-Step "pg_restore into the package database"
  $restore = Invoke-Capture (Join-Path $pgBin 'pg_restore.exe') @('-h', '127.0.0.1', '-p', "$buildPort", '-U', 'qip', '-d', 'qip', '--no-owner', '--no-privileges', '--exit-on-error', $dumpFile) $pgEnv $null
  if ($restore.Code -ne 0) { throw "pg_restore failed: $($restore.Err)" }
  Remove-Item -LiteralPath $dumpFile -Force   # holds real account hashes: do not leave it around
  $nTables = Invoke-Psql 'qip' "SELECT count(*) FROM information_schema.tables WHERE table_schema='qip'"
  $nUsersBefore = Invoke-Psql 'qip' 'SELECT count(*) FROM qip.auth_users'
  Write-Host "  restored schema qip: $nTables tables, $nUsersBefore accounts before scrubbing"

  # ---- migrations -----------------------------------------------------------------------------------
  Write-Step "migrate --check"
  $dbEnv = @{ 'DATABASE_URL' = $buildDbUrl }
  $mig = Invoke-Manage @('migrate', '--check') $dbEnv -AllowFail
  $migrateNote = 'migrate --check: consistent (nothing to apply)'
  if ($mig.Code -ne 0) {
    Write-Host "  unapplied migrations after the restore: running migrate" -ForegroundColor Yellow
    $m2 = Invoke-Manage @('migrate', '--noinput') $dbEnv
    $migrateNote = 'migrate --check found unapplied migrations; migrate was run on the package database'
  }
  Write-Host "  $migrateNote"

  # ---- accounts ------------------------------------------------------------------------------------------
  Write-Step "Tester / demo accounts, scrub"
  $snippetFile = Join-Path $stageRoot 'readme-accounts.txt'
  $seedArgs = @('uat_seed_testers', '--out', $passFile, '--reset-demo', '--scrub', '--default-roster', '--readme-snippet', $snippetFile)
  if ($haveCsv) { $seedArgs += @('--csv', $TestersCsv) }
  $r = Invoke-Manage $seedArgs $dbEnv
  $seedSummary = $r.Out.Trim()
  Write-Host "  $seedSummary"

  if (-not $AdminPassword) { $AdminPassword = New-AdminPassword; $adminGenerated = $true } else { $adminGenerated = $false }
  $r = Invoke-Manage @('seed_admin', '--reset') ($dbEnv + @{ 'SEED_ADMIN_PASSWORD' = $AdminPassword })
  Write-Host "  admin account reset (first login forces a password change)"
  $adminNote = if ($adminGenerated) { 'random password generated by the build' } else { 'password given with -AdminPassword' }
  $adminBlock = "`r`n## Administrator`r`n`r`nFirst login forces a password change. This account is for the QC center; do not hand it to testers.`r`n`r`n" +
                "| Account | Name | Password | Roles |`r`n|---|---|---|---|`r`n| admin | system administrator | ``$AdminPassword`` | admin |`r`n"
  [IO.File]::AppendAllText($passFile, $adminBlock, (New-Object Text.UTF8Encoding($false)))

  # ---- optional: case level Da Vinci data ----------------------------------------------------------------
  $davinciNote = 'davinci_cases kept (full copy of the development data)'
  if ($DropDavinciCases) {
    $before = Invoke-Psql 'qip' 'SELECT count(*) FROM qip.davinci_cases'
    Invoke-Psql 'qip' 'TRUNCATE TABLE qip.davinci_cases' | Out-Null
    $davinciNote = "davinci_cases emptied ($before rows removed); davinci_indicator_values (monthly aggregates) and import logs kept"
    Write-Host "  $davinciNote"
  }

  $nUsers  = Invoke-Psql 'qip' 'SELECT count(*) FROM qip.auth_users'
  $nUsable = Invoke-Psql 'qip' "SELECT count(*) FROM qip.auth_users WHERE password NOT LIKE '!%'"
  $nAssign = Invoke-Psql 'qip' 'SELECT count(*) FROM qip.entry_assignments'
  Write-Host "  accounts in the package: $nUsers ($nUsable can log in with a password), assignments: $nAssign"

  Write-Step "VACUUM, CHECKPOINT"
  Invoke-Psql 'qip' 'VACUUM ANALYZE' | Out-Null
  Invoke-Psql 'qip' 'CHECKPOINT' | Out-Null
} finally {
  if ($pgStarted) {
    $code = Invoke-Native $pgctl @('-D', $pgData, '-m', 'fast', '-w', '-t', '90', 'stop') $null
    if ($code -ne 0) { Write-Host "WARNING: pg_ctl stop returned $code" -ForegroundColor Red }
  }
  if (Test-Path -LiteralPath $dumpFile) { Remove-Item -LiteralPath $dumpFile -Force }
}
if (Test-Path -LiteralPath (Join-Path $pgData 'postmaster.pid')) { throw "postmaster.pid is still in $pgData after pg_ctl stop" }
Write-Host "  cluster stopped, no postmaster.pid ; pgdata $(Get-DirSizeMB $pgData) MB"

# ----------------------------------------------------------------------------------------------
# 6. start.bat, stop.bat, README, BUILD-INFO
# ----------------------------------------------------------------------------------------------
Write-Step "start.bat, stop.bat, README, BUILD-INFO"
$tplDir = Join-Path $here 'package'
foreach ($bat in 'start.bat', 'stop.bat') {
  $t = [IO.File]::ReadAllText((Join-Path $tplDir $bat))
  if ($t -match '[^\x00-\x7F]') { throw "$bat must be plain ASCII" }
  Write-TextFile (Join-Path $pack $bat) $t $false $true
}

$pyVer = ((& $python --version) 2>&1 | Out-String).Trim()
$djVer = (Invoke-Capture $python @('-c', 'import django; print(django.get_version())') @{} $null).Out.Trim()
$info = @(
  "QIP UAT portable package - build info",
  "Package : $pkgName",
  "Built   : $(Get-Date -Format 'yyyy-MM-dd HH:mm')",
  "Commit  : $gitHash$gitDirty",
  "Python  : $pyVer (embeddable), Django $djVer, waitress",
  "Database: PostgreSQL $PgVersion (portable) on 127.0.0.1:$PgRunPort ; this build ran it on port $buildPort",
  "Data    : copy of the development database (schema qip) taken at build time",
  "          $davinciNote",
  "Accounts: $nUsers in the package ($nUsable can log in with a password; the others were scrubbed)",
  "Login   : local temporary passwords only (no AD in this package)",
  "Frontend: static export (npm run build:export), served by Django/WhiteNoise"
)
Write-TextFile (Join-Path $pack 'BUILD-INFO.txt') (($info -join "`r`n") + "`r`n") $false $true

# README: the shared role accounts and the demo accounts (with their passwords) come from the snippet written by
# uat_seed_testers; the admin account is never in it.  Chinese file name as escapes: this script must stay ASCII
# (Windows PowerShell 5.1 reads BOM-less scripts as ANSI).
$readmeName = [regex]::Unescape('README-\u540c\u4ec1\u6e2c\u8a66\u8aaa\u660e.txt')
$accountsText = [IO.File]::ReadAllText($snippetFile, [Text.Encoding]::UTF8).TrimEnd()
$readme = [IO.File]::ReadAllText((Join-Path $tplDir 'README-template.txt'), [Text.Encoding]::UTF8)
$readme = $readme.Replace('@@VERSION@@', "$stamp (commit $gitHash)").Replace('@@ACCOUNTS@@', $accountsText).Replace('@@BUILD_INFO@@', ($info -join "`r`n"))
Write-TextFile (Join-Path $pack $readmeName) $readme $true $true

# ----------------------------------------------------------------------------------------------
# 7. verify the tree, clean caches, zip
# ----------------------------------------------------------------------------------------------
Write-Step "Cleaning __pycache__ and verifying the tree"
@(Get-ChildItem -LiteralPath $pack -Recurse -Directory -Force -Filter '__pycache__') | ForEach-Object { if (Test-Path -LiteralPath $_.FullName) { Remove-Item -LiteralPath $_.FullName -Recurse -Force } }
$problems = New-Object System.Collections.ArrayList
$all = Get-ChildItem -LiteralPath $pack -Recurse -Force
foreach ($f in $all) {
  $rel = $f.FullName.Substring($pack.Length + 1)
  if (-not $f.PSIsContainer -and $f.Extension -in '.xls', '.xlsx', '.xlsm', '.csv') {
    # the Django admin / openpyxl packages ship no data files with these extensions; a hit is a leak
    [void]$problems.Add("data file: $rel")
  }
  if ($f.Name -like '.env.prod*') { [void]$problems.Add("env file: $rel") }
  if ($f.PSIsContainer -and $f.Name -in 'venv', '.venv', 'tests', '_pytest', 'pytest', 'pytest_django') { [void]$problems.Add("dir: $rel") }
  if ($f.Name -eq 'postmaster.pid') { [void]$problems.Add("pid file: $rel") }
}
if ($problems.Count -gt 0) { $problems | ForEach-Object { Write-Host "  LEAK: $_" -ForegroundColor Red }; throw "The staged package is not clean ($($problems.Count) finding(s))." }
# no development password / AD settings in .env ; the passwords file must not be inside the package
$envNow = [IO.File]::ReadAllText($envPath)
if ($envNow -match '(?im)^\s*(LDAP_(?!ENABLED)|AD_)') { throw ".env contains AD settings" }
if ($envNow -match '(?im)^\s*DB_PASSWORD') { throw ".env contains DB_PASSWORD" }

Write-Step "Zipping to $zipPath"
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
$packFull = [IO.Path]::GetFullPath($pack)
$parentLen = (Split-Path $packFull -Parent).Length + 1
$fs = [IO.File]::Open($zipPath, [IO.FileMode]::CreateNew)
$za = New-Object IO.Compression.ZipArchive($fs, [IO.Compression.ZipArchiveMode]::Create)
$nFiles = 0; $nDirs = 0
try {
  foreach ($item in (Get-ChildItem -LiteralPath $packFull -Recurse -Force)) {
    $rel = ($item.FullName.Substring($parentLen)) -replace '\\', '/'
    if ($item.PSIsContainer) {
      # directory entries keep the empty folders PostgreSQL insists on (pg_twophase, pg_tblspc, ...) and logs\, data\media\
      if (@(Get-ChildItem -LiteralPath $item.FullName -Force).Count -eq 0) { [void]$za.CreateEntry($rel + '/'); $nDirs++ }
      continue
    }
    $entry = $za.CreateEntry($rel, [IO.Compression.CompressionLevel]::Optimal)
    $entry.LastWriteTime = $item.LastWriteTime
    $es = $entry.Open()
    try { $in = [IO.File]::OpenRead($item.FullName); try { $in.CopyTo($es) } finally { $in.Dispose() } } finally { $es.Dispose() }
    $nFiles++
  }
} finally { $za.Dispose(); $fs.Dispose() }

$zipSize = (Get-Item -LiteralPath $zipPath).Length
$zipHash = Get-Sha256 $zipPath
[IO.File]::WriteAllText("$zipPath.sha256", "$zipHash  $(Split-Path $zipPath -Leaf)`r`n")
$free2 = Get-FreeGB $CacheDir
$elapsed = [math]::Round(((Get-Date) - $buildStart).TotalMinutes, 1)

if ($Clean) { Remove-Item -LiteralPath $stageRoot -Recurse -Force; Write-Host "  staging folder removed (-Clean)" }

Write-Host ""
Write-Host "================ RESULT ==================="
Write-Host "Zip       : $zipPath"
Write-Host ("Size      : {0:N0} bytes ({1} MB), {2} files + {3} empty folders" -f $zipSize, [math]::Round($zipSize / 1MB, 1), $nFiles, $nDirs)
Write-Host "SHA256    : $zipHash"
Write-Host "Passwords : $passFile  (NOT in the package; give each tester only their own line)"
Write-Host "Accounts  : $nUsers ($nUsable can log in)  Assignments: $nAssign"
Write-Host "Davinci   : $davinciNote"
Write-Host "Migrations: $migrateNote"
Write-Host "Staging   : $(if ($Clean) { 'removed' } else { $pack })"
Write-Host "Free GB   : before $free0 / after $free2 ; build took $elapsed min"
