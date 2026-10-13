<#
.SYNOPSIS
  Builds the "probe pack" (qip-probe-<yyyymmdd>.zip): embedded Python 3.12 + compiled wheels
  (numpy, psycopg-binary, ldap3) + a trimmed portable PostgreSQL 16, plus probe.bat.

.DESCRIPTION
  PowerShell 5.1 compatible, ASCII-only source, re-runnable.
  - Every download is pinned (version + SHA256). Downloads are cached in <CacheDir> and are NOT
    repeated when the cached file already exists (its SHA256 is verified against the pin).
  - If a pinned SHA256 is empty, the first run records the computed value and prints it
    (copy it into the $Pins table below to pin it).
  - No DLL is copied from the build machine (System32 etc.); the probe checks the target machine.

.PARAMETER CacheDir
  Download cache.   Default: <main-worktree>\local-data\runtime-cache   (gitignored)
.PARAMETER OutDir
  Output folder.    Default: <main-worktree>\local-data\uat             (gitignored)
.PARAMETER MinFreeGB
  Abort when the drive of CacheDir has less free space than this (default 15).
#>
[CmdletBinding()]
param(
  [string]$CacheDir,
  [string]$OutDir,
  [int]$MinFreeGB = 15
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'   # Invoke-WebRequest is very slow with the progress bar on 5.1
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

# ----------------------------------------------------------------------------------------------
# Pins (version + SHA256).  Only python.org, files.pythonhosted.org and get.enterprisedb.com.
# ----------------------------------------------------------------------------------------------
$PyVersion = '3.12.10'    # last 3.12.x that ships Windows binaries (3.12.11+ return 404, checked by HEAD)
$PgVersion = '16.15-5'    # newest EDB 16.x binaries zip found by HEAD (16.15-6.. and 16.16-x return 403)

$PyFile  = "python-$PyVersion-embed-amd64.zip"
$PyUrl   = "https://www.python.org/ftp/python/$PyVersion/$PyFile"
$PgFile  = "postgresql-$PgVersion-windows-x64-binaries.zip"
$PgUrl   = "https://get.enterprisedb.com/postgresql/$PgFile"

# pip requirement pins (cp312 / win_amd64 wheels). tzdata (win32) and typing_extensions (python<3.13) are
# psycopg dependencies whose environment markers 'pip download' evaluates for the BUILD machine's Python
# (3.14), so they must be listed explicitly. The probe caught a missing typing_extensions on 3.12.
$WheelReqs = @('numpy==2.5.4', 'psycopg-binary==3.3.6', 'psycopg==3.3.6', 'ldap3==2.9.1', 'pyasn1==0.6.4', 'tzdata==2026.5', 'typing_extensions==4.16.0')

# file name -> expected SHA256 (lower case).  Empty = record on first run.
$Pins = @{
  $PyFile                                          = '4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3'
  $PgFile                                          = '43bb45f173a6f08cf1d29a97a6d8deb119e8e8093a24c00d2d1001a0ccaa8281'
  'numpy-2.5.4-cp312-cp312-win_amd64.whl'          = 'a7b1b6353e36a7e50de2973a38d705c88ee93adcf120673cee7f45a4a3fa223a'
  'psycopg_binary-3.3.6-cp312-cp312-win_amd64.whl' = 'e23a66a763fbe83fcc210bc77c27e5a5ea380ebf091c06f34d8561b695e5a40f'
  'psycopg-3.3.6-py3-none-any.whl'                 = 'a1db9f7148b06a28606767efaca51fa6f9398c5c0a3810519be69d7000bdb631'
  'ldap3-2.9.1-py2.py3-none-any.whl'               = '5869596fc4948797020d3f03b7939da938778a0f9e2009f7a072ccf92b8e8d70'
  'pyasn1-0.6.4-py3-none-any.whl'                  = 'deda9277cfd454080ec40b207fb6df82206a3a2688735233cdcd8d3d565f088b'
  'tzdata-2026.5-py2.py3-none-any.whl'             = 'b683bd1b6659ddcd810ff02ad09ba821d4bf1065072805063eb35c49617905ac'
  'typing_extensions-4.16.0-py3-none-any.whl'      = '481caa481374e813c1b176ada14e97f1f67a4539ce9cfeb3f350d78d6370c2e8'
}

# ----------------------------------------------------------------------------------------------
function Write-Step([string]$m) { Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) -ForegroundColor Cyan }

function Get-FreeGB([string]$path) {
  $root = [IO.Path]::GetPathRoot((Resolve-Path $path).Path)
  $d = New-Object IO.DriveInfo($root)
  return [math]::Round($d.AvailableFreeSpace / 1GB, 1)
}

function Get-Sha256([string]$path) { (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLower() }

function Test-UrlExists([string]$url) {
  try { $r = Invoke-WebRequest -Method Head -UseBasicParsing -Uri $url -TimeoutSec 60; return ($r.StatusCode -eq 200) }
  catch { return $false }
}

$script:DownloadLog = New-Object System.Collections.ArrayList

# Verify (and if needed download) a pinned file into the cache. Returns the full path.
function Get-PinnedFile([string]$url, [string]$dest) {
  $name = Split-Path $dest -Leaf
  $expected = $Pins[$name]
  $fromCache = $false
  if (Test-Path -LiteralPath $dest) {
    $h = Get-Sha256 $dest
    if ($expected -and $h -ne $expected) { throw "Cached $name has SHA256 $h but pin is $expected. Delete it or fix the pin." }
    $fromCache = $true
    Write-Host "  cache hit: $name"
  } else {
    if (-not (Test-UrlExists $url)) { throw "HEAD check failed (not 200): $url -- bump the pinned version in build-probe.ps1" }
    Write-Host "  downloading $url"
    $part = "$dest.part"
    if (Test-Path -LiteralPath $part) { Remove-Item -LiteralPath $part -Force }
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $part
    Move-Item -LiteralPath $part -Destination $dest
    $h = Get-Sha256 $dest
    if ($expected -and $h -ne $expected) { Remove-Item -LiteralPath $dest -Force; throw "Downloaded $name has SHA256 $h but pin is $expected." }
  }
  $size = (Get-Item -LiteralPath $dest).Length
  if (-not $expected) { Write-Host "  NOTE: no pin yet for $name -> SHA256 $h" -ForegroundColor Yellow }
  [void]$script:DownloadLog.Add([pscustomobject]@{ Name=$name; Url=$url; Bytes=$size; Sha256=$h; Cached=$fromCache; Pinned=[bool]$expected })
  return $dest
}

# Extract a zip (or wheel) into $destDir. Optional $prefixes: only entries whose name starts with one
# of them are extracted; $stripPrefix is removed from the entry name.  Includes a zip-slip guard.
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

function Get-DirSizeMB([string]$p) {
  $s = (Get-ChildItem -LiteralPath $p -Recurse -File -Force | Measure-Object Length -Sum).Sum
  return [math]::Round($s / 1MB, 1)
}

# ----------------------------------------------------------------------------------------------
# Paths
# ----------------------------------------------------------------------------------------------
$here = $PSScriptRoot
if (-not $CacheDir -or -not $OutDir) {
  # main working tree = parent of the common .git dir (works from a git worktree too)
  $base = $null
  try {
    Push-Location $here
    $common = (& git rev-parse --git-common-dir 2>$null)
    if ($LASTEXITCODE -eq 0 -and $common) {
      if (-not [IO.Path]::IsPathRooted($common)) { $common = Join-Path $here $common }
      $base = Split-Path ([IO.Path]::GetFullPath($common)) -Parent
    }
  } catch {} finally { Pop-Location }
  if (-not $base) { $base = [IO.Path]::GetFullPath((Join-Path $here '..\..')) }
  if (-not $CacheDir) { $CacheDir = Join-Path $base 'local-data\runtime-cache' }
  if (-not $OutDir)   { $OutDir   = Join-Path $base 'local-data\uat' }
}
$WheelDir = Join-Path $CacheDir 'wheels'
$Stage    = Join-Path $CacheDir 'stage-probe'
$Pack     = Join-Path $Stage 'qip-probe'
New-Item -ItemType Directory -Force -Path $CacheDir, $WheelDir, $OutDir | Out-Null

$free0 = Get-FreeGB $CacheDir
Write-Step "Free space before: $free0 GB on the cache drive (minimum $MinFreeGB GB)"
if ($free0 -lt $MinFreeGB) { throw "Only $free0 GB free; need at least $MinFreeGB GB. Stopping." }

# ----------------------------------------------------------------------------------------------
# 1. Downloads
# ----------------------------------------------------------------------------------------------
Write-Step "Embedded Python $PyVersion"
$pyZip = Get-PinnedFile $PyUrl (Join-Path $CacheDir $PyFile)

Write-Step "Wheels (cp312 / win_amd64)"
$missing = $false
foreach ($k in $Pins.Keys) { if ($k -like '*.whl' -and -not (Test-Path -LiteralPath (Join-Path $WheelDir $k))) { $missing = $true } }
if ($missing) {
  $py = Get-Command python -ErrorAction SilentlyContinue
  if (-not $py) { throw "Local 'python' not found; it is only needed for 'pip download' when the wheel cache is empty." }
  $pipArgs = @('-m','pip','download','--only-binary=:all:','--no-deps','--platform','win_amd64','--python-version','3.12',
               '--implementation','cp','--abi','cp312','-d',$WheelDir) + $WheelReqs
  & python @pipArgs
  if ($LASTEXITCODE -ne 0) { throw "pip download failed (exit $LASTEXITCODE). No cp312 wheel for one of: $($WheelReqs -join ', ')" }
} else {
  Write-Host "  cache hit: all wheels present in $WheelDir"
}
$wheelFiles = @()
foreach ($k in ($Pins.Keys | Where-Object { $_ -like '*.whl' } | Sort-Object)) {
  $wp = Join-Path $WheelDir $k
  if (-not (Test-Path -LiteralPath $wp)) { throw "Wheel missing after pip download: $k (pins out of date?)" }
  $h = Get-Sha256 $wp
  if ($Pins[$k] -and $h -ne $Pins[$k]) { throw "Wheel $k has SHA256 $h but pin is $($Pins[$k])." }
  if (-not $Pins[$k]) { Write-Host "  NOTE: no pin yet for $k -> SHA256 $h" -ForegroundColor Yellow }
  [void]$script:DownloadLog.Add([pscustomobject]@{ Name=$k; Url="https://files.pythonhosted.org/ (via pip download)"; Bytes=(Get-Item -LiteralPath $wp).Length; Sha256=$h; Cached=(-not $missing); Pinned=[bool]$Pins[$k] })
  $wheelFiles += $wp
}

Write-Step "PostgreSQL $PgVersion (EDB binaries zip)"
$pgZip = Get-PinnedFile $PgUrl (Join-Path $CacheDir $PgFile)

# ----------------------------------------------------------------------------------------------
# 2. Assemble
# ----------------------------------------------------------------------------------------------
Write-Step "Assembling $Pack"
if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Pack | Out-Null

$pyDir = Join-Path $Pack 'runtime\python'
Expand-ZipSafe $pyZip $pyDir $null $null

# python312._pth: enable site + add Lib\site-packages
$pth = Get-ChildItem -LiteralPath $pyDir -Filter 'python3*._pth' | Select-Object -First 1
if (-not $pth) { throw "python3xx._pth not found in the embeddable package" }
$lines = Get-Content -LiteralPath $pth.FullName
$out = New-Object System.Collections.ArrayList
$haveSp = $false
foreach ($l in $lines) {
  if ($l -match '^\s*#\s*import\s+site\s*$') { [void]$out.Add('import site'); continue }
  if ($l -match '^\s*Lib\\site-packages\s*$') { $haveSp = $true }
  [void]$out.Add($l)
}
if (-not $haveSp) {
  # keep "import site" last, put Lib\site-packages before it
  $idx = $out.IndexOf('import site')
  if ($idx -ge 0) { $out.Insert($idx, 'Lib\site-packages') } else { [void]$out.Add('Lib\site-packages'); [void]$out.Add('import site') }
}
[IO.File]::WriteAllLines($pth.FullName, [string[]]$out, (New-Object Text.ASCIIEncoding))

$sp = Join-Path $pyDir 'Lib\site-packages'
New-Item -ItemType Directory -Force -Path $sp | Out-Null
foreach ($w in $wheelFiles) { Write-Host "  wheel -> site-packages: $(Split-Path $w -Leaf)"; Expand-ZipSafe $w $sp $null $null }

Write-Step "Extracting only bin/lib/share from the PostgreSQL zip (this takes a minute)"
$pgDir = Join-Path $Pack 'runtime\pgsql'
Expand-ZipSafe $pgZip $pgDir @('pgsql/bin/','pgsql/lib/','pgsql/share/') 'pgsql/'
foreach ($must in 'bin\postgres.exe','bin\initdb.exe','bin\pg_ctl.exe','bin\psql.exe','share\postgres.bki') {
  if (-not (Test-Path -LiteralPath (Join-Path $pgDir $must))) { throw "PostgreSQL trim lost a required file: $must" }
}
# StackBuilder (+ its wxWidgets DLLs) and import libs are not needed to run a server
$pgBin = Join-Path $pgDir 'bin'
Get-ChildItem -LiteralPath $pgBin -File | Where-Object { $_.Name -ieq 'stackbuilder.exe' -or $_.Name -like 'wx*.dll' -or $_.Extension -ieq '.lib' } |
  ForEach-Object { Write-Host "  removing bin\$($_.Name)"; Remove-Item -LiteralPath $_.FullName -Force }
$pgMB = Get-DirSizeMB $pgDir
$pyMB = Get-DirSizeMB $pyDir
Write-Host "  runtime\pgsql after trimming: $pgMB MB ; runtime\python: $pyMB MB"

# probe scripts
Copy-Item -LiteralPath (Join-Path $here 'probe\probe.bat') -Destination $Pack
Get-ChildItem -LiteralPath (Join-Path $here 'probe') -Filter 'README*' | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $Pack }

# ----------------------------------------------------------------------------------------------
# 3. VC++ runtime DLL findings (recorded, NOT copied from this machine)
# ----------------------------------------------------------------------------------------------
Write-Step "Checking bundled VC++ runtime DLLs"
$dllNames = 'vcruntime140.dll','vcruntime140_1.dll','msvcp140.dll'
$dllReport = New-Object System.Collections.ArrayList
foreach ($d in @(@{L='runtime\python'; P=$pyDir}, @{L='runtime\pgsql\bin'; P=(Join-Path $pgDir 'bin')})) {
  foreach ($n in $dllNames) {
    $present = Test-Path -LiteralPath (Join-Path $d.P $n)
    $word = 'ABSENT'; if ($present) { $word = 'present' }
    [void]$dllReport.Add(("{0,-20} {1,-18} {2}" -f $d.L, $n, $word))
  }
}
$dllReport | ForEach-Object { Write-Host "  $_" }
Get-ChildItem -LiteralPath (Join-Path $pgDir 'lib') -File -Filter '*.lib' | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
$pgMB = Get-DirSizeMB $pgDir
# which PostgreSQL binaries import msvcp140.dll / vcruntime140.dll (string scan of the PE import tables)
$latin1 = [Text.Encoding]::GetEncoding(28591)
$needMsvcp = @(); $needVcrt = 0
foreach ($f in (Get-ChildItem -LiteralPath (Join-Path $pgDir 'bin') -File | Where-Object { $_.Extension -in '.exe','.dll' })) {
  $txt = $latin1.GetString([IO.File]::ReadAllBytes($f.FullName))
  if ($txt.IndexOf('msvcp140.dll', [StringComparison]::OrdinalIgnoreCase) -ge 0) { $needMsvcp += $f.Name }
  if ($txt.IndexOf('vcruntime140.dll', [StringComparison]::OrdinalIgnoreCase) -ge 0) { $needVcrt++ }
}
Write-Host "  pgsql\bin files importing msvcp140.dll: $($needMsvcp -join ', ')"
Write-Host "  pgsql\bin files importing vcruntime140.dll: $needVcrt"
# any bundled copy inside site-packages (delvewheel puts msvcp140-*.dll in *.libs)
$spDll = @(Get-ChildItem -LiteralPath $sp -Recurse -File -Filter 'msvcp140*.dll' | ForEach-Object { $_.FullName.Substring($Pack.Length + 1) })
if ($spDll.Count -gt 0) { Write-Host "  bundled by wheels: $($spDll -join ', ')" }

# ----------------------------------------------------------------------------------------------
# 4. BUILD-INFO.txt inside the pack
# ----------------------------------------------------------------------------------------------
$stamp = Get-Date -Format 'yyyyMMdd'
$info = New-Object System.Collections.ArrayList
[void]$info.Add("QIP probe pack - build info")
[void]$info.Add("Built: $(Get-Date -Format 'yyyy-MM-dd HH:mm')")
[void]$info.Add("")
[void]$info.Add("Components (pinned):")
foreach ($d in $script:DownloadLog) { [void]$info.Add(("  {0}  {1}  {2} bytes" -f $d.Sha256, $d.Name, $d.Bytes)) }
[void]$info.Add("")
[void]$info.Add("Trimmed sizes: runtime\python = $pyMB MB, runtime\pgsql (bin+lib+share only) = $pgMB MB")
[void]$info.Add("")
[void]$info.Add("VC++ runtime DLLs inside the pack (none are copied from the build machine):")
$dllReport | ForEach-Object { [void]$info.Add("  $_") }
if ($spDll.Count -gt 0) { [void]$info.Add("  bundled by wheels: " + ($spDll -join ', ')) }
[void]$info.Add("  pgsql\bin files importing msvcp140.dll: " + ($needMsvcp -join ', ') + " ; importing vcruntime140.dll: $needVcrt files (all need the system VC++ runtime)")
[void]$info.Add("The probe checks %SystemRoot%\System32\msvcp140.dll on the target machine.")
[IO.File]::WriteAllLines((Join-Path $Pack 'BUILD-INFO.txt'), [string[]]$info, (New-Object Text.UTF8Encoding($false)))

# ----------------------------------------------------------------------------------------------
# 5. Zip (forward-slash entry names, top folder qip-probe/)
# ----------------------------------------------------------------------------------------------
Write-Step "Zipping"
$zipPath = Join-Path $OutDir "qip-probe-$stamp.zip"
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
$packFull = [IO.Path]::GetFullPath($Pack)
$parentLen = (Split-Path $packFull -Parent).Length + 1
$fs = [IO.File]::Open($zipPath, [IO.FileMode]::CreateNew)
$za = New-Object IO.Compression.ZipArchive($fs, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($f in (Get-ChildItem -LiteralPath $packFull -Recurse -File -Force)) {
    $rel = ($f.FullName.Substring($parentLen)) -replace '\\', '/'
    $entry = $za.CreateEntry($rel, [IO.Compression.CompressionLevel]::Optimal)
    $entry.LastWriteTime = $f.LastWriteTime
    $es = $entry.Open()
    try { $in = [IO.File]::OpenRead($f.FullName); try { $in.CopyTo($es) } finally { $in.Dispose() } } finally { $es.Dispose() }
  }
} finally { $za.Dispose(); $fs.Dispose() }

$zipSize = (Get-Item -LiteralPath $zipPath).Length
$zipHash = Get-Sha256 $zipPath
$free1 = Get-FreeGB $CacheDir

Write-Host ""
Write-Host "================ DOWNLOADS ================"
foreach ($d in $script:DownloadLog) {
  Write-Host $d.Name
  Write-Host ("    {0}" -f $d.Url)
  Write-Host ("    {0:N0} bytes  SHA256 {1}  cached={2} pinned={3}" -f $d.Bytes, $d.Sha256, $d.Cached, $d.Pinned)
}
Write-Host "================ RESULT ==================="
Write-Host "Zip      : $zipPath"
Write-Host ("Size     : {0:N0} bytes ({1} MB)" -f $zipSize, [math]::Round($zipSize / 1MB, 1))
Write-Host "SHA256   : $zipHash"
Write-Host "Unpacked : python $pyMB MB + pgsql $pgMB MB"
Write-Host "Free GB  : before $free0 / after $free1"
[IO.File]::WriteAllText("$zipPath.sha256", "$zipHash  $(Split-Path $zipPath -Leaf)`r`n")
