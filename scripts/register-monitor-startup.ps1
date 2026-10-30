$ErrorActionPreference = 'Stop'
$monitorDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$monitorExecutable = Join-Path $monitorDirectory 'WisenetPtzBridge.exe'
if (!(Test-Path (Join-Path $monitorDirectory 'data/server-settings.protected'))) {
    throw 'Run server setup first (server-settings.protected is required).'
}
$monitorUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$monitorAction = New-ScheduledTaskAction -Execute $monitorExecutable -Argument '--no-browser' -WorkingDirectory $monitorDirectory
$monitorTrigger = New-ScheduledTaskTrigger -AtLogOn -User $monitorUser
$monitorPrincipal = New-ScheduledTaskPrincipal -UserId $monitorUser -LogonType Interactive -RunLevel Limited
$monitorSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'FireMonitoringServer' -Action $monitorAction -Trigger $monitorTrigger -Principal $monitorPrincipal -Settings $monitorSettings -Force | Out-Null
Write-Host 'Server starts after sign-in with this Windows user. Locking the screen keeps it running; shutting down or sleeping stops reception.'
