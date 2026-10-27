param(
 [string]$Username = '',
 [string]$DataDirectory = (Join-Path $PSScriptRoot '../../data'),
 [string]$BaseUrl = 'http://127.0.0.1:8787/'
)
$ErrorActionPreference = 'Stop'
$taskNode = (Get-Command node -ErrorAction Stop).Source
$taskArguments = @((Join-Path $PSScriptRoot '../recover-password.mjs'), '--data-dir', [System.IO.Path]::GetFullPath($DataDirectory), '--base-url', $BaseUrl)
if ($Username) { $taskArguments += @('--username', $Username) }
$taskOutput = & $taskNode @taskArguments
if ($LASTEXITCODE -ne 0) { throw 'ساخت لینک بازیابی انجام نشد' }
$taskRecovery = $taskOutput | ConvertFrom-Json
Write-Host 'لینک بازیابی یک بارمصرف است و ۲۰ دقیقه اعتبار دارد:'
Write-Host $taskRecovery.url
# The user explicitly runs this launcher to open the recovery form.
Start-Process -FilePath $taskRecovery.url
