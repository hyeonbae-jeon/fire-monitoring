param([ValidateSet('Menu','Start','Receive','Settings','Stop','Restore','Startup','RemoveStartup')][string]$Action = 'Menu')
$ErrorActionPreference = 'Stop'
$receiverRoot = $PSScriptRoot
$receiverExe = Join-Path $receiverRoot 'app/WisenetPtzBridge.exe'
$env:CCTV_DATA_DIR = Join-Path $receiverRoot 'data'
$env:MAP_CONFIG_FILE = Join-Path $env:CCTV_DATA_DIR 'map.demo.json'
$receiverUrl = 'http://127.0.0.1:5080/'
function Get-Receiver {
    $recordPath = Join-Path $env:CCTV_DATA_DIR 'receiver.pid.json'
    if (!(Test-Path -LiteralPath $recordPath)) { return $null }
    try {
        $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
        $process = Get-Process -Id $record.processId -ErrorAction Stop
        if ($process.Path -ieq $receiverExe -and $process.StartTime.ToUniversalTime().Ticks -eq [long]$record.startTicks) { return $process }
    } catch { }
    return $null
}
function Stop-Receiver {
    $process = Get-Receiver
    if ($null -ne $process) { Stop-Process -InputObject $process; $process.WaitForExit() }
}
function Start-Receiver {
    if (!(Test-Path -LiteralPath $receiverExe)) { throw 'Receiver files are missing. Run Setup.cmd again.' }
    if (!(Test-Path -LiteralPath (Join-Path $env:CCTV_DATA_DIR 'server-settings.protected'))) {
        & $receiverExe --initialize-monitoring
        if ($LASTEXITCODE -ne 0) { throw 'Initial administrator setup was not saved.' }
    }
    if ($null -eq (Get-Receiver)) {
        # Do not mistake another installation on the same port for this receiver.
        try { $test = Invoke-WebRequest -Uri ($receiverUrl + 'health') -UseBasicParsing -TimeoutSec 2 } catch { $test = $null }
        if ($null -ne $test) { throw 'Port 5080 is already in use. Stop the previous receiver first.' }
        Start-Process -FilePath "$env:SystemRoot/System32/wscript.exe" -ArgumentList ('"' + (Join-Path $receiverRoot 'Receiver.vbs') + '"') -WorkingDirectory $receiverRoot | Out-Null
        for ($attempt = 0; $attempt -lt 40; $attempt++) {
            Start-Sleep -Milliseconds 500
            if ($null -ne (Get-Receiver)) { return }
        }
        throw 'Receiver did not start. Use app/문제진단.cmd for a local diagnostic. Do not share credentials or raw logs.'
    }
}
function Set-Startup([bool]$enabled) {
    $startupLink = Join-Path ([Environment]::GetFolderPath('Startup')) 'FireMonitoringReceiver.lnk'
    if ($enabled) {
        if (!(Test-Path -LiteralPath (Join-Path $env:CCTV_DATA_DIR 'server-settings.protected'))) { throw 'Create the initial administrator account first.' }
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($startupLink)
        $shortcut.TargetPath = "$env:SystemRoot/System32/wscript.exe"
        $shortcut.Arguments = '"' + (Join-Path $receiverRoot 'Receiver.vbs') + '"'
        $shortcut.WorkingDirectory = $receiverRoot
        $shortcut.Save()
        Write-Host '현재 Windows 사용자 로그인 시 자동 시작을 등록했습니다. 잠금 중에도 수신하며 로그아웃·절전·종료 시에는 중단됩니다.'
    } elseif (Test-Path -LiteralPath $startupLink) {
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($startupLink)
        if ($shortcut.Arguments -ne ('"' + (Join-Path $receiverRoot 'Receiver.vbs') + '"')) { throw 'This startup entry belongs to another installation.' }
        Remove-Item -LiteralPath $startupLink
        Write-Host '로그인 시 자동 시작을 해제했습니다. 현재 수신기를 중지하려면 수신 중지를 선택하세요.'
    }
}
# Serialize launch/stop/update operations for this installation and Windows session.
$pathHash = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($receiverRoot.ToLowerInvariant()))).Replace('-','')
$mutex = New-Object Threading.Mutex($false, ('Local\FireMonitor-' + $pathHash))
try {
    if (!$mutex.WaitOne(0)) { throw 'Another launcher or update is already running.' }
    if ($Action -eq 'Menu') {
        Write-Host "`n산불감시 통합 실행 도구"
        Write-Host '1. 감시 화면 열기 (백그라운드 수신 시작)'
        Write-Host '2. 웹 관리자 설정 열기'
        Write-Host '3. Windows 로그인 시 자동 시작 등록'
        Write-Host '4. 자동 시작 해제'
        Write-Host '5. 수신기 중지'
        Write-Host '6. 암호화 백업 복원 (복원 후 수신 시작)'
        Write-Host 'Enter 또는 창 닫기: 종료 (이미 실행한 수신기는 계속 동작)'
        $choice = Read-Host '선택'
        $Action = switch ($choice) { '1' {'Start'} '2' {'Settings'} '3' {'Startup'} '4' {'RemoveStartup'} '5' {'Stop'} '6' {'Restore'} default {'Menu'} }
    }
    switch ($Action) {
        'Receive' { Start-Receiver }
        'Start' { Start-Receiver; Start-Process $receiverUrl }
        'Settings' { Start-Receiver; Start-Process ($receiverUrl + '?settings=1') }
        'Stop' { Stop-Receiver; Write-Host '수신기를 중지했습니다. 웹접속·영상·메일 수신도 중지됩니다.' }
        'Restore' { Stop-Receiver; & $receiverExe --restore-settings-backup; if ($LASTEXITCODE -ne 0) { throw 'Backup restore failed. Previous settings were retained.' }; Start-Receiver; Start-Process $receiverUrl }
        'Startup' { Set-Startup $true }
        'RemoveStartup' { Set-Startup $false }
    }
} catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }
finally { try { $mutex.ReleaseMutex() } catch { }; $mutex.Dispose() }
