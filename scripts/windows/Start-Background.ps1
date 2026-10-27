param(
 [string]$DataDirectory = (Join-Path $PSScriptRoot '../../data'),
 [string]$LogDirectory = (Join-Path $PSScriptRoot '../../var/log'),
 [string]$NodePath = 'C:\Program Files\nodejs\node.exe',
 [ValidateRange(1024,65535)][int]$Port = 8787
)
$ErrorActionPreference = 'Stop'
$serverFile = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../server.mjs'))
$dataRoot = [IO.Path]::GetFullPath($DataDirectory)
$logRoot = [IO.Path]::GetFullPath($LogDirectory)
if (!(Test-Path -LiteralPath $serverFile -PathType Leaf)) { throw 'Server source not found' }
if (!(Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw 'Node.js executable not found' }
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$mutex = New-Object Threading.Mutex($false, ('Local\Motavan-Local-' + $Port))
$acquired = $false
try {
 try { $acquired = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $acquired = $true }
 if (!$acquired) { exit 0 }
 $env:DATA_DIR = $dataRoot
 $env:HOST = '127.0.0.1'
 $env:PORT = [string]$Port
 $lifecycleLog = Join-Path $logRoot 'content-desk.lifecycle.log'
 function Write-Lifecycle([string]$Message) {
  Add-Content -LiteralPath $lifecycleLog -Encoding UTF8 -Value ((Get-Date -Format o) + ' ' + $Message)
 }
 Write-Lifecycle ('Supervisor started; pid=' + $PID + '; port=' + $Port)
 $retrySeconds = 2
 while ($true) {
  $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  if ($listeners.Count) {
   $owners = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
   if ($owners.Count -ne 1) { throw 'Unexpected listeners on the configured port' }
   $owner = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $owners[0])
   if (!$owner -or !$owner.CommandLine.Contains($serverFile)) { throw 'The configured port belongs to another application' }
   $existing = [Diagnostics.Process]::GetProcessById($owners[0])
   Write-Lifecycle ('Monitoring existing server; pid=' + $existing.Id)
   $existing.WaitForExit()
   Write-Lifecycle 'Existing server stopped'
  }
  # Keep the previous server logs instead of overwriting the last failure.
  foreach ($stream in @('stdout', 'stderr')) {
   $logFile = Join-Path $logRoot ('content-desk.' + $stream + '.log')
   if ((Test-Path -LiteralPath $logFile) -and (Get-Item -LiteralPath $logFile).Length) {
    $archive = Join-Path $logRoot ('content-desk.' + $stream + '.' + (Get-Date -Format 'yyyyMMdd-HHmmss-ffff') + '.log')
    Move-Item -LiteralPath $logFile -Destination $archive
   }
  }
  $startedAt = Get-Date
  $child = Start-Process -FilePath $NodePath -ArgumentList @(('"' + $serverFile + '"')) -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot 'content-desk.stdout.log') -RedirectStandardError (Join-Path $logRoot 'content-desk.stderr.log') -PassThru
  Set-Content -LiteralPath (Join-Path $logRoot 'content-desk.pid') -Value $child.Id
  Write-Lifecycle ('Server started; pid=' + $child.Id)
  $null = $child.Handle
  $child.WaitForExit()
  $child.Refresh()
  Write-Lifecycle ('Server exited; pid=' + $child.Id + '; code=' + $child.ExitCode + '; retrySeconds=' + $retrySeconds)
  if (((Get-Date) - $startedAt).TotalSeconds -ge 60) { $retrySeconds = 2 }
  Start-Sleep -Seconds $retrySeconds
  $retrySeconds = [Math]::Min(30, $retrySeconds * 2)
 }
} finally {
 if ($acquired) { $mutex.ReleaseMutex() }
 $mutex.Dispose()
}
