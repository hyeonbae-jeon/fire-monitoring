param([string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'FireMonitoring'), [string]$LegacyRoot = '', [switch]$NonInteractive, [switch]$NoLaunch, [switch]$NoShortcut)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$payload = Join-Path $PSScriptRoot 'payload.zip'
$expected = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'payload.sha256') -Raw).Trim()
if ($expected -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash -ne $expected) { throw 'Package checksum failed. Download the installer again.' }
if (!$NonInteractive) {
    Write-Host "`n산불감시 설치·업데이트 통합"
    Write-Host ('설치 위치: ' + $InstallRoot)
    Write-Host '기존 지도·카메라·메일·계정 설정은 유지합니다. 같은 설치 도구로 업데이트합니다.'
    if (!(Test-Path -LiteralPath (Join-Path $InstallRoot 'data/server-settings.protected'))) {
        Write-Host '이 PC의 이전 실행 폴더를 입력하면 data 설정을 가져옵니다. 다른 PC의 암호화 파일은 직접 복사할 수 없습니다.'
        $LegacyRoot = (Read-Host '이전 WisenetPtzBridge.exe 폴더 (새 설치는 Enter)').Trim('"')
    }
}
if ($InstallRoot -eq [IO.Path]::GetPathRoot($InstallRoot)) { throw 'Select an application directory, not a drive root.' }
# Reject junction/symlink paths before directory mutation.
$check = $InstallRoot
while ($check) {
    if ((Test-Path -LiteralPath $check) -and ((Get-Item -Force -LiteralPath $check).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Installation through a junction or symbolic link is not supported.' }
    $parent = Split-Path -Parent $check
    if ($parent -eq $check) { break }; $check = $parent
}
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
$pathHash = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($InstallRoot.ToLowerInvariant()))).Replace('-','')
$mutex = New-Object Threading.Mutex($false, ('Local\FireMonitor-' + $pathHash))
$staging = Join-Path $InstallRoot ('.stage-' + [Guid]::NewGuid().ToString('N'))
$prior = Join-Path $InstallRoot ('.previous-' + [Guid]::NewGuid().ToString('N'))
$app = Join-Path $InstallRoot 'app'
$wasRunning = $false
function Stop-OwnProcess([string]$exe) {
    foreach ($process in @(Get-Process -Name WisenetPtzBridge -ErrorAction SilentlyContinue)) {
        try { $path = $process.Path } catch { continue }
        if ($path -ieq $exe) { Stop-Process -InputObject $process; $process.WaitForExit(); $script:wasRunning = $true }
    }
}
try {
    if (!$mutex.WaitOne(0)) { throw 'Close the launcher or wait for the other update before retrying.' }
    if ((Test-Path -LiteralPath $app) -and ((Get-Item -Force -LiteralPath $app).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Application directory must not be a junction.' }
    New-Item -ItemType Directory -Path $staging | Out-Null
    $archive = [IO.Compression.ZipFile]::OpenRead($payload)
    try {
        $prefix = 'Wisenet-Camera-Inventory-Demo/'
        foreach ($entry in $archive.Entries) {
            if (!$entry.FullName.StartsWith($prefix, [StringComparison]::Ordinal)) { throw 'Unexpected payload root.' }
            $relative = $entry.FullName.Substring($prefix.Length)
            if (!$relative) { continue }
            if ($relative.Contains('\') -or $relative.Contains(':') -or $relative.Split('/') -contains '..' -or $relative.Split('/') -contains '.') { throw 'Unsafe payload path.' }
            $destination = [IO.Path]::GetFullPath((Join-Path $staging $relative))
            if (!$destination.StartsWith($staging + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Payload escapes its directory.' }
            if ($relative.EndsWith('/')) { New-Item -ItemType Directory -Force -Path $destination | Out-Null; continue }
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $false)
        }
    } finally { $archive.Dispose() }
    if (!(Test-Path -LiteralPath (Join-Path $staging 'WisenetPtzBridge.exe')) -or !(Test-Path -LiteralPath (Join-Path $staging 'wwwroot/index.html'))) { throw 'Incomplete payload.' }
    $data = Join-Path $InstallRoot 'data'
    if ((Test-Path -LiteralPath $data) -and ((Get-Item -Force -LiteralPath $data).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Data directory must not be a junction.' }
    if ($LegacyRoot) {
        $LegacyRoot = [IO.Path]::GetFullPath($LegacyRoot)
        $legacyData = Join-Path $LegacyRoot 'data'
        if (!(Test-Path -LiteralPath (Join-Path $LegacyRoot 'WisenetPtzBridge.exe')) -or !(Test-Path -LiteralPath $legacyData)) { throw 'Previous application/data folder not found.' }
        if ((Test-Path -LiteralPath $data) -and @(Get-ChildItem -LiteralPath $data -Force).Count -gt 0) { throw 'Existing central data is present. Use encrypted backup restore instead of merging.' }
        if (@(Get-ChildItem -LiteralPath $legacyData -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count -gt 0 -or ((Get-Item -Force -LiteralPath $legacyData).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Previous data contains a junction.' }
        # Stop only the legacy executable explicitly selected by this user.
        $legacyExe = Join-Path $LegacyRoot 'WisenetPtzBridge.exe'
        $task = Get-ScheduledTask -TaskName FireMonitoringServer -ErrorAction SilentlyContinue
        if ($task -and @($task.Actions | Where-Object { $_.Execute -ieq $legacyExe }).Count -gt 0) {
            Disable-ScheduledTask -InputObject $task | Out-Null
            Stop-ScheduledTask -InputObject $task -ErrorAction SilentlyContinue
            Write-Host '이전 수신기 자동 시작을 해제했습니다. 새 통합 도구에서 자동 시작을 등록하세요.'
        }
        Stop-OwnProcess $legacyExe
        $migration = Join-Path $InstallRoot ('.migration-' + [Guid]::NewGuid().ToString('N'))
        try { Copy-Item -LiteralPath $legacyData -Destination $migration -Recurse -Force; if (Test-Path -LiteralPath $data) { Remove-Item -LiteralPath $data }; Move-Item -LiteralPath $migration -Destination $data }
        finally { if (Test-Path -LiteralPath $migration) { Remove-Item -LiteralPath $migration -Recurse -Force } }
    }
    Stop-OwnProcess (Join-Path $app 'WisenetPtzBridge.exe')
    if (Test-Path -LiteralPath $app) { Move-Item -LiteralPath $app -Destination $prior }
    try {
        Move-Item -LiteralPath $staging -Destination $app
        foreach ($name in @('Launcher.ps1','Receiver.vbs','산불감시.cmd')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $InstallRoot $name) -Force }
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot '사용방법.txt') -Destination (Join-Path $InstallRoot '사용방법.txt') -Force
    } catch {
        if (Test-Path -LiteralPath $app) { Remove-Item -LiteralPath $app -Recurse -Force }
        if (Test-Path -LiteralPath $prior) { Move-Item -LiteralPath $prior -Destination $app }
        throw
    }
    if (Test-Path -LiteralPath $prior) { Remove-Item -LiteralPath $prior -Recurse -Force }
    if (!$NoShortcut) {
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) '산불감시.lnk'))
        $shortcut.TargetPath = Join-Path $InstallRoot '산불감시.cmd'; $shortcut.WorkingDirectory = $InstallRoot; $shortcut.Save()
    }
    Write-Host '설치·업데이트 완료. 바탕화면의 산불감시에서 모든 실행·설정을 진행하세요.'
} finally {
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
    try { $mutex.ReleaseMutex() } catch { }; $mutex.Dispose()
}
if (!$NoLaunch) { & (Join-Path $InstallRoot 'Launcher.ps1') -Action $(if ($wasRunning) {'Start'} else {'Menu'}) }
