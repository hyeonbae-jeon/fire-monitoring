$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$work = Join-Path ([IO.Path]::GetTempPath()) ('fire-install-check-' + [Guid]::NewGuid().ToString('N'))
$package = Join-Path $work 'package'
$install = Join-Path $work '설치 폴더 with spaces'
$inputRoot = Join-Path $work 'input'
try {
    New-Item -ItemType Directory -Force -Path $package,(Join-Path $inputRoot 'Wisenet-Camera-Inventory-Demo/wwwroot') | Out-Null
    foreach ($file in Get-ChildItem -LiteralPath (Join-Path $repository 'scripts/unified') -File) {
        Copy-Item -LiteralPath $file.FullName -Destination $package
        if ($file.Extension -eq '.ps1') {
            $tokens = $null; $errors = $null
            [System.Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$errors) | Out-Null
            if ($errors.Count -gt 0) { throw 'PowerShell parse failed.' }
        }
    }
    Copy-Item -LiteralPath (Join-Path $repository 'docs/unified-receiver.md') -Destination (Join-Path $package '사용방법.txt')
    Set-Content -LiteralPath (Join-Path $inputRoot 'Wisenet-Camera-Inventory-Demo/WisenetPtzBridge.exe') -Value 'synthetic executable is never run'
    Set-Content -LiteralPath (Join-Path $inputRoot 'Wisenet-Camera-Inventory-Demo/wwwroot/index.html') -Value 'version-one'
    $payload = Join-Path $package 'payload.zip'
    [IO.Compression.ZipFile]::CreateFromDirectory($inputRoot,$payload)
    (Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash | Set-Content -LiteralPath (Join-Path $package 'payload.sha256')
    & (Join-Path $package 'Install.ps1') -InstallRoot $install -NonInteractive -NoLaunch -NoShortcut
    $data = Join-Path $install 'data'
    New-Item -ItemType Directory -Force -Path $data | Out-Null
    $secret = [byte[]](1,4,8,16,32,64,128,255)
    [IO.File]::WriteAllBytes((Join-Path $data 'server-settings.protected'), $secret)
    Set-Content -LiteralPath (Join-Path $data 'map.demo.json') -Value 'synthetic-preserved-map'
    Set-Content -LiteralPath (Join-Path $install 'app/obsolete.dll') -Value 'old-dependency'
    Set-Content -LiteralPath (Join-Path $inputRoot 'Wisenet-Camera-Inventory-Demo/wwwroot/index.html') -Value 'version-two'
    Remove-Item -LiteralPath $payload
    [IO.Compression.ZipFile]::CreateFromDirectory($inputRoot,$payload)
    (Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash | Set-Content -LiteralPath (Join-Path $package 'payload.sha256')
    & (Join-Path $package 'Install.ps1') -InstallRoot $install -NonInteractive -NoLaunch -NoShortcut
    if ((Get-Content -LiteralPath (Join-Path $install 'app/wwwroot/index.html') -Raw).Trim() -ne 'version-two' -or (Test-Path -LiteralPath (Join-Path $install 'app/obsolete.dll'))) { throw 'Update did not replace application files.' }
    if ([Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $data 'server-settings.protected'))) -ne [Convert]::ToBase64String($secret) -or (Get-Content -LiteralPath (Join-Path $data 'map.demo.json') -Raw).Trim() -ne 'synthetic-preserved-map') { throw 'Update replaced saved operator data.' }
    # A checksum mismatch and traversal entry must fail before changing the installed application/data.
    '0' * 64 | Set-Content -LiteralPath (Join-Path $package 'payload.sha256')
    $rejected = $false
    try { & (Join-Path $package 'Install.ps1') -InstallRoot $install -NonInteractive -NoLaunch -NoShortcut } catch { $rejected = $true }
    if (!$rejected) { throw 'Checksum mismatch accepted.' }
    Remove-Item -LiteralPath $payload
    $archive = [IO.Compression.ZipFile]::Open($payload,[IO.Compression.ZipArchiveMode]::Create)
    $entry = $archive.CreateEntry('Wisenet-Camera-Inventory-Demo/../../outside.txt'); $writer = New-Object IO.StreamWriter($entry.Open()); $writer.Write('bad'); $writer.Dispose(); $archive.Dispose()
    (Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash | Set-Content -LiteralPath (Join-Path $package 'payload.sha256')
    $rejected = $false
    try { & (Join-Path $package 'Install.ps1') -InstallRoot $install -NonInteractive -NoLaunch -NoShortcut } catch { $rejected = $true }
    if (!$rejected -or (Test-Path -LiteralPath (Join-Path $work 'outside.txt'))) { throw 'Traversal payload was not rejected.' }
    if ((Get-Content -LiteralPath (Join-Path $install 'app/wwwroot/index.html') -Raw).Trim() -ne 'version-two') { throw 'Bad package changed installed application.' }
    if (@(Get-ChildItem -LiteralPath $install -Directory -Filter '.stage-*').Count -gt 0) { throw 'Failed staging cleanup.' }
    Write-Host 'Unified installer parsing, spaced/Korean paths, fresh install, update, data preservation, obsolete-file removal, checksum and traversal checks passed.'
} finally { if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force } }
