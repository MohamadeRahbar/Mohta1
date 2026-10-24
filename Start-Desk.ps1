param(
 [string]$DataDirectory = (Join-Path $PSScriptRoot '../../work/content-desk-data'),
 [ValidateRange(1024,65535)][int]$Port = 8787,
 [switch]$Foreground
)
$ErrorActionPreference = 'Stop'
$taskName = 'Motavan-Local-' + $Port
$background = if (!$Foreground) { Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue }
if ($background -and @($background.Actions)[0].Arguments.Contains((Join-Path $PSScriptRoot 'Start-Background.ps1')) -and @($background.Actions)[0].Arguments.Contains([IO.Path]::GetFullPath($DataDirectory))) {
 if ($background.State -ne 'Running') { Start-ScheduledTask -TaskName $taskName }
 Write-Output ('Motavan: http://127.0.0.1:' + $Port + ' (background task)')
 return
}
$nodeCommand = Get-Command node -ErrorAction Stop
$env:DATA_DIR = [System.IO.Path]::GetFullPath($DataDirectory)
$env:HOST = '127.0.0.1'
$env:PORT = [string]$Port
Push-Location $PSScriptRoot
try { & $nodeCommand.Source server.mjs } finally { Pop-Location }
