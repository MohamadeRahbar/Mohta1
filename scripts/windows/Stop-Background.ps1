param(
 [string]$DataDirectory = (Join-Path $PSScriptRoot '../../data'),
 [string]$LogDirectory = (Join-Path $PSScriptRoot '../../var/log'),
 [ValidateRange(1024,65535)][int]$Port = 8787,
 [switch]$DisableAutoStart
)
$ErrorActionPreference = 'Stop'
$runner = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'Start-Background.ps1'))
$serverFile = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../server.mjs'))
$dataRoot = [IO.Path]::GetFullPath($DataDirectory)
$taskName = 'Motavan-Local-' + $Port
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task -and (!@($task.Actions)[0].Arguments.Contains($runner) -or !@($task.Actions)[0].Arguments.Contains($dataRoot))) { throw 'Unexpected scheduled task; nothing stopped' }
$listener = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
$ownerId = $null
if ($listener.Count) {
 $owners = @($listener | Select-Object -ExpandProperty OwningProcess -Unique)
 if ($owners.Count -ne 1) { throw 'Unexpected listeners; nothing stopped' }
 $ownerId = $owners[0]
 $owner = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $ownerId)
 if (!$owner -or !$owner.CommandLine.Contains($serverFile)) { throw 'Port belongs to another application; nothing stopped' }
}
$previousData = $env:MOTAVAN_STOP_DATA_DIR
try {
 $env:MOTAVAN_STOP_DATA_DIR = $dataRoot
 $check = @'
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const root=process.env.MOTAVAN_STOP_DATA_DIR,catalog=path.join(root,'workspaces.sqlite');
if(fs.existsSync(catalog)){
 const db=new DatabaseSync(catalog,{readOnly:true}),brands=db.prepare('SELECT id FROM workspaces').all();db.close();
 for(const {id} of brands){const file=path.join(root,id==='default'?'':'brands/'+id,'desk.sqlite');if(!fs.existsSync(file))continue;const tenant=new DatabaseSync(file,{readOnly:true});const active=tenant.prepare("SELECT count(*) AS n FROM publications WHERE status='sending'").get().n,hasControls=tenant.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='message_operations'").get(),operations=hasControls?tenant.prepare("SELECT count(*) AS n FROM message_operations WHERE status='running'").get().n:0;tenant.close();if(active||operations)throw Error('Publishing or message control is in progress; stop postponed');}
}
'@
 $check | & (Get-Command node).Source --input-type=module
 if ($LASTEXITCODE -ne 0) { throw 'Stop postponed because the data check failed' }
} finally { $env:MOTAVAN_STOP_DATA_DIR = $previousData }
if ($task) {
 if ($DisableAutoStart) { Disable-ScheduledTask -TaskName $taskName | Out-Null }
 Stop-ScheduledTask -TaskName $taskName
 for ($attempt=0; $attempt -lt 20; $attempt++) { if ((Get-ScheduledTask -TaskName $taskName).State -ne 'Running') { break }; Start-Sleep -Milliseconds 100 }
 if ((Get-ScheduledTask -TaskName $taskName).State -eq 'Running') { throw 'Supervisor did not stop' }
}
if ($ownerId) {
 $remaining=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $ownerId)
 if ($remaining -and $remaining.CommandLine.Contains($serverFile)) { $process=[Diagnostics.Process]::GetProcessById($ownerId);$process.Kill();$null=$process.WaitForExit(5000) }
}
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw 'The port is still listening' }
$logRoot=[IO.Path]::GetFullPath($LogDirectory)
if(Test-Path -LiteralPath $logRoot){Add-Content -LiteralPath (Join-Path $logRoot 'content-desk.lifecycle.log') -Encoding UTF8 -Value ((Get-Date -Format o) + ' Manual stop')}
Write-Output ('Motavan stopped on port ' + $Port)
