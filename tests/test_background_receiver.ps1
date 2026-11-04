$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$work = Join-Path ([IO.Path]::GetTempPath()) ('fire-background-check-' + [Guid]::NewGuid().ToString('N'))
$launcher = Join-Path $work 'Launcher.ps1'
try {
    New-Item -ItemType Directory -Force -Path $work | Out-Null
    Copy-Item -LiteralPath (Join-Path $repository 'scripts/unified/Launcher.ps1') -Destination $launcher
    Copy-Item -LiteralPath (Join-Path $repository 'scripts/unified/Receiver.vbs') -Destination (Join-Path $work 'Receiver.vbs')
    dotnet publish (Join-Path $repository 'bridge/WisenetPtzBridge') -c Release --self-contained false -o (Join-Path $work 'app') --nologo
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic receiver publish failed.' }
    dotnet run --project (Join-Path $repository 'tests/ServerSecurityChecks') -c Release --no-build -- --write-receiver-fixture (Join-Path $work 'data')
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic receiver fixture setup failed.' }
    # Use the user's Windows PowerShell 5.1, not the test host PowerShell 7.
    & "$env:SystemRoot/System32/WindowsPowerShell/v1.0/powershell.exe" -NoProfile -ExecutionPolicy Bypass -File $launcher -Action Receive
    if ($LASTEXITCODE -ne 0) { throw 'Hidden receiver start failed.' }
    $first = Get-Content -LiteralPath (Join-Path $work 'data/receiver.pid.json') -Raw | ConvertFrom-Json
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:5080/health' -TimeoutSec 3
    if (!$health.serverMode) { throw 'Background receiver is not in authenticated server mode.' }
    & "$env:SystemRoot/System32/WindowsPowerShell/v1.0/powershell.exe" -NoProfile -ExecutionPolicy Bypass -File $launcher -Action Receive
    if ($LASTEXITCODE -ne 0) { throw 'Repeated start failed.' }
    $second = Get-Content -LiteralPath (Join-Path $work 'data/receiver.pid.json') -Raw | ConvertFrom-Json
    if ($first.processId -ne $second.processId) { throw 'Launcher created a duplicate receiver.' }
    & "$env:SystemRoot/System32/WindowsPowerShell/v1.0/powershell.exe" -NoProfile -ExecutionPolicy Bypass -File $launcher -Action Stop
    if ($LASTEXITCODE -ne 0) { throw 'Receiver stop failed.' }
    if (Get-Process -Id $first.processId -ErrorAction SilentlyContinue) { throw 'Receiver still runs after Stop.' }
    Write-Host 'Windows PowerShell 5.1 launcher, hidden VBS receiver, continued health after launcher exit, duplicate start and explicit Stop checks passed.'
} finally {
    if (Test-Path -LiteralPath $launcher) { & $launcher -Action Stop }
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
