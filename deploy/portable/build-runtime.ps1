<#
.SYNOPSIS
  Builds the full embedded runtime of the portable build: Python 3.12 (embeddable) + every wheel of
  backend\requirements-portable.txt unzipped into Lib\site-packages.  No installer, no admin rights.

.DESCRIPTION
  PowerShell 5.1 compatible, ASCII-only source, re-runnable.
  - Python zip comes from the cache (same pin as build-probe.ps1); a missing file is downloaded and checked
    against the pinned SHA256.  Wheels are fetched with the build machine's `python -m pip download` for
    win_amd64 / cp312 into <CacheDir>\wheels-full and reused on later runs.
  - Existing wheels in <CacheDir>\wheels (left by build-probe.ps1) are offered to pip as --find-links, so they are
    not downloaded again.
  - The runtime folder is rebuilt from scratch on every run.
  - Finishes by importing every runtime package with the EMBEDDED python; a failed import fails the script.

  Output:  <CacheDir>\runtime-full\python\   (the folder later packaged as runtime\python)
           <CacheDir>\runtime-full\BUILD-INFO.txt

.PARAMETER CacheDir
  Download cache.  Default: <main-worktree>\local-data\runtime-cache   (gitignored)
.PARAMETER RuntimeDir
  Output folder.   Default: <CacheDir>\runtime-full
.PARAMETER WithTests
  Also install pytest and pytest-django (development machines only; never ship them).
.PARAMETER MinFreeGB
  Abort when the cache drive has less free space than this (default 15).
#>
[CmdletBinding()]
param(
  [string]$CacheDir,
  [string]$RuntimeDir,
  [switch]$WithTests,
  [int]$MinFreeGB = 15
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

# Same pin as build-probe.ps1 (last 3.12.x with Windows binaries).
$PyVersion = '3.12.10'
$PyFile    = "python-$PyVersion-embed-amd64.zip"
$PyUrl     = "https://www.python.org/ftp/python/$PyVersion/$PyFile"
$PySha256  = '4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3'

# Everything the Django side must be able to import (acceptance check, run with the embedded python).
$ImportNames = @('django','rest_framework','psycopg','numpy','Levenshtein','ldap3','whitenoise','waitress',
                 'axes','environ','openpyxl','xlrd','corsheaders','redis')
$TestReqs    = @('pytest>=8.0', 'pytest-django>=4.8')
$TestImports = @('pytest','pytest_django')

function Write-Step([string]$m) { Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) -ForegroundColor Cyan }
function Get-Sha256([string]$path) { (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLower() }
function Get-DirSizeMB([string]$p) {
  $s = (Get-ChildItem -LiteralPath $p -Recurse -File -Force | Measure-Object Length -Sum).Sum
  return [math]::Round($s / 1MB, 1)
}
function Get-FreeGB([string]$path) {
  $root = [IO.Path]::GetPathRoot((Resolve-Path $path).Path)
  return [math]::Round((New-Object IO.DriveInfo($root)).AvailableFreeSpace / 1GB, 1)
}

# Unzip a zip / wheel into $destDir with a zip-slip guard.
function Expand-ZipSafe([string]$zipPath, [string]$destDir) {
  $destFull = [IO.Path]::GetFullPath($destDir)
  if (-not $destFull.EndsWith('\')) { $destFull += '\' }
  New-Item -ItemType Directory -Force -Path $destFull | Out-Null
  $zip = [IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    foreach ($e in $zip.Entries) {
      $n = $e.FullName
      if (-not $n) { continue }
      $target = [IO.Path]::GetFullPath((Join-Path $destFull ($n -replace '/', '\')))
      if (-not $target.StartsWith($destFull, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe zip entry: $($e.FullName)" }
      if ($n.EndsWith('/')) { New-Item -ItemType Directory -Force -Path $target | Out-Null; continue }
      New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
      [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $target, $true)
    }
  } finally { $zip.Dispose() }
}

# ----------------------------------------------------------------------------------------------
# Paths
# ----------------------------------------------------------------------------------------------
$here     = $PSScriptRoot
$repoRoot = [IO.Path]::GetFullPath((Join-Path $here '..\..'))
if (-not $CacheDir) {
  # main working tree = parent of the common .git dir (also correct when run from a git worktree)
  $base = $null
  try {
    Push-Location $here
    $common = (& git rev-parse --git-common-dir 2>$null)
    if ($LASTEXITCODE -eq 0 -and $common) {
      if (-not [IO.Path]::IsPathRooted($common)) { $common = Join-Path $here $common }
      $base = Split-Path ([IO.Path]::GetFullPath($common)) -Parent
    }
  } catch {} finally { Pop-Location }
  if (-not $base) { $base = $repoRoot }
  $CacheDir = Join-Path $base 'local-data\runtime-cache'
}
if (-not $RuntimeDir) { $RuntimeDir = Join-Path $CacheDir 'runtime-full' }
$ReqFile   = Join-Path $repoRoot 'backend\requirements-portable.txt'
$OldWheels = Join-Path $CacheDir 'wheels'
$WheelDir  = Join-Path $CacheDir 'wheels-full'
if (-not (Test-Path -LiteralPath $ReqFile)) { throw "Not found: $ReqFile" }
New-Item -ItemType Directory -Force -Path $CacheDir, $WheelDir | Out-Null

$free0 = Get-FreeGB $CacheDir
Write-Step "Free space: $free0 GB on the cache drive (minimum $MinFreeGB GB)"
if ($free0 -lt $MinFreeGB) { throw "Only $free0 GB free; need at least $MinFreeGB GB. Stopping." }

# ----------------------------------------------------------------------------------------------
# 1. Python zip (cache first)
# ----------------------------------------------------------------------------------------------
Write-Step "Embedded Python $PyVersion"
$pyZip = Join-Path $CacheDir $PyFile
if (Test-Path -LiteralPath $pyZip) {
  Write-Host "  cache hit: $PyFile"
} else {
  Write-Host "  downloading $PyUrl"
  Invoke-WebRequest -UseBasicParsing -Uri $PyUrl -OutFile "$pyZip.part"
  Move-Item -LiteralPath "$pyZip.part" -Destination $pyZip
}
$h = Get-Sha256 $pyZip
if ($h -ne $PySha256) { throw "$PyFile has SHA256 $h but the pin is $PySha256. Delete the file or fix the pin." }

# ----------------------------------------------------------------------------------------------
# 2. Wheels
# ----------------------------------------------------------------------------------------------
Write-Step "Wheels for cp312 / win_amd64 -> $WheelDir"
$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { throw "Local 'python' not found; it is needed for 'pip download'." }
$pipArgs = @('-m','pip','download','--only-binary=:all:','--platform','win_amd64','--python-version','3.12',
             '--implementation','cp','--abi','cp312','-r',$ReqFile,'-d',$WheelDir)
if ($WithTests) { $pipArgs += $TestReqs }
if (Test-Path -LiteralPath $OldWheels) { $pipArgs += @('--find-links', $OldWheels) }
& python @pipArgs
if ($LASTEXITCODE -ne 0) { throw "pip download failed (exit $LASTEXITCODE)." }
$wheelFiles = @(Get-ChildItem -LiteralPath $WheelDir -Filter '*.whl' | Sort-Object Name)
Write-Host "  $($wheelFiles.Count) wheels, $([math]::Round((($wheelFiles | Measure-Object Length -Sum).Sum) / 1MB, 1)) MB"

# ----------------------------------------------------------------------------------------------
# 3. Assemble runtime\python
# ----------------------------------------------------------------------------------------------
Write-Step "Assembling $RuntimeDir"
if (Test-Path -LiteralPath $RuntimeDir) { Remove-Item -LiteralPath $RuntimeDir -Recurse -Force }
$pyDir = Join-Path $RuntimeDir 'python'
Expand-ZipSafe $pyZip $pyDir

# python312._pth: enable site and add Lib\site-packages, so wheels only need to be unzipped.
# NOTE: with a ._pth file the embedded python ignores PYTHONPATH and the current directory (for -m / -c),
# so anything outside site-packages (the backend folder) must be put on sys.path by the launcher.
$pth = Get-ChildItem -LiteralPath $pyDir -Filter 'python3*._pth' | Select-Object -First 1
if (-not $pth) { throw "python3xx._pth not found in the embeddable package" }
$out = New-Object System.Collections.ArrayList
$haveSp = $false
foreach ($l in (Get-Content -LiteralPath $pth.FullName)) {
  if ($l -match '^\s*#\s*import\s+site\s*$') { [void]$out.Add('import site'); continue }
  if ($l -match '^\s*Lib\\site-packages\s*$') { $haveSp = $true }
  [void]$out.Add($l)
}
if (-not $haveSp) {
  $idx = $out.IndexOf('import site')
  if ($idx -ge 0) { $out.Insert($idx, 'Lib\site-packages') } else { [void]$out.Add('Lib\site-packages'); [void]$out.Add('import site') }
}
[IO.File]::WriteAllLines($pth.FullName, [string[]]$out, (New-Object Text.ASCIIEncoding))

$sp = Join-Path $pyDir 'Lib\site-packages'
New-Item -ItemType Directory -Force -Path $sp | Out-Null
foreach ($w in $wheelFiles) { Expand-ZipSafe $w.FullName $sp }
Write-Host "  unpacked $($wheelFiles.Count) wheels into Lib\site-packages"

# ----------------------------------------------------------------------------------------------
# 4. Acceptance: import everything with the EMBEDDED python
# ----------------------------------------------------------------------------------------------
Write-Step "Import check with the embedded python"
$names = @($ImportNames)
if ($WithTests) { $names += $TestImports }
$code = ($names | ForEach-Object { "import $_" }) -join '; '
$code += "; import sys; print('OK python', sys.version.split()[0], 'imported:', '$($names -join ',')')"
& (Join-Path $pyDir 'python.exe') -I -c $code
if ($LASTEXITCODE -ne 0) { throw "Import check FAILED with the embedded python (exit $LASTEXITCODE)." }

# ----------------------------------------------------------------------------------------------
# 5. Size + BUILD-INFO.txt
# ----------------------------------------------------------------------------------------------
$sizeMB = Get-DirSizeMB $pyDir
$info = New-Object System.Collections.ArrayList
[void]$info.Add("QIP portable runtime - build info")
[void]$info.Add("Built: $(Get-Date -Format 'yyyy-MM-dd HH:mm')")
[void]$info.Add("Python: $PyVersion embeddable (SHA256 $PySha256)")
[void]$info.Add("Requirements: backend\requirements-portable.txt$(if ($WithTests) { ' + pytest, pytest-django' })")
[void]$info.Add("Unpacked size of runtime\python: $sizeMB MB")
[void]$info.Add("")
[void]$info.Add("Wheels (SHA256  file):")
foreach ($w in $wheelFiles) { [void]$info.Add(("  {0}  {1}" -f (Get-Sha256 $w.FullName), $w.Name)) }
[IO.File]::WriteAllLines((Join-Path $RuntimeDir 'BUILD-INFO.txt'), [string[]]$info, (New-Object Text.UTF8Encoding($false)))

Write-Host ""
Write-Host "Runtime : $pyDir"
Write-Host "Size    : $sizeMB MB unpacked ($($wheelFiles.Count) wheels)"
Write-Host "Free GB : before $free0 / after $(Get-FreeGB $CacheDir)"
