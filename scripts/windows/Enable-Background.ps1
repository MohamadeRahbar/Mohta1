param(
 [string]$DataDirectory = (Join-Path $PSScriptRoot '../../data'),
 [string]$LogDirectory = (Join-Path $PSScriptRoot '../../var/log'),
 [ValidateRange(1024,65535)][int]$Port = 8787
)
$ErrorActionPreference = 'Stop'
$runner = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'Start-Background.ps1'))
$nodePath = (Get-Command node -ErrorAction Stop).Source
$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskName = 'Motavan-Local-' + $Port
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and !(@($existing.Actions)[0].Arguments.Contains($runner))) { throw 'A different application already uses this task name' }
$dataRoot = [IO.Path]::GetFullPath($DataDirectory)
$logRoot = [IO.Path]::GetFullPath($LogDirectory)
if ($existing -and !(@($existing.Actions)[0].Arguments.Contains($dataRoot))) { throw 'The existing task uses another data directory; stop and review its configuration first' }
$serverFile = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../server.mjs'))
$listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
foreach ($listener in $listeners) {
 $owner = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $listener.OwningProcess)
 if (!$owner -or !$owner.CommandLine.Contains($serverFile)) { throw 'The configured port belongs to another application; nothing changed' }
}

foreach ($argument in @($runner, $nodePath, $dataRoot, $logRoot)) { if ($argument.Contains('"')) { throw 'Invalid quoted path' } }
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $runner + '" -DataDirectory "' + $dataRoot + '" -LogDirectory "' + $logRoot + '" -NodePath "' + $nodePath + '" -Port ' + $Port
$windowsPowerShell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
if (!(Test-Path -LiteralPath $windowsPowerShell)) { throw 'Windows PowerShell not found' }
$action = New-ScheduledTaskAction -Execute $windowsPowerShell -Argument $arguments -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $account
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
if (!$existing -or $existing.State -ne 'Running') {
 Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Motavan local panel, loopback only, automatic recovery and start at user logon' -Force | Out-Null
 Start-ScheduledTask -TaskName $taskName
}
$healthy = $false
for ($check = 0; $check -lt 40; $check++) {
 try { $health = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $Port + '/healthz') -TimeoutSec 1; if ($health.ok -and (Get-ScheduledTask -TaskName $taskName).State -eq 'Running') { $healthy = $true; break } } catch {}
 Start-Sleep -Milliseconds 250
}
if (!$healthy) { throw ('Panel did not start; inspect logs in ' + $logRoot) }
[pscustomobject]@{ok=$true; task=$taskName; address=('http://127.0.0.1:' + $Port); version=$health.version} | ConvertTo-Json
