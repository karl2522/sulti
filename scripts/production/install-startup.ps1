<#
.SYNOPSIS
  Start the Sulti companion automatically when you log on to Windows.

.DESCRIPTION
  Registers a scheduled task named "Sulti companion" that runs
  run-companion.ps1 hidden at logon, as you (so TTS and "copy to PC" reach
  your desktop). The runner restarts the companion if it exits.

  Build first (npm run build). Run again to update; -Uninstall removes it.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\production\install-startup.ps1 -DryRun
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\production\install-startup.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\production\install-startup.ps1 -Uninstall
#>
[CmdletBinding()]
param([switch]$Uninstall, [switch]$DryRun, [string]$NodePath)
$ErrorActionPreference = 'Stop'
$TaskName = 'Sulti companion'

if ($Uninstall) {
  if ($DryRun) { Write-Host "Would remove the scheduled task '$TaskName'."; exit 0 }
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed '$TaskName'. A companion that is still running stops at your next sign-out, or end it in Task Manager."
  exit 0
}

# Version managers (fnm, nvm) put per-shell links on PATH; use the real node.exe so the task survives new shells.
if (-not $NodePath) { $NodePath = (Get-Command node.exe -ErrorAction Stop).Source }
$item = Get-Item -LiteralPath $NodePath
$target = @($item.Target) | Where-Object { $_ } | Select-Object -First 1
$node = (Resolve-Path -LiteralPath $(if ($target) { $target } else { $NodePath })).Path

$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path -LiteralPath (Join-Path $repo 'apps\companion\dist\cli.js'))) { throw 'Build first: npm run build' }
$runner = Join-Path $PSScriptRoot 'run-companion.ps1'
$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`" -Node `"$node`""
$user = "$env:USERDOMAIN\$env:USERNAME"

if ($DryRun) {
  Write-Host "Task:    $TaskName (at logon of $user)"
  Write-Host "Runs:    $ps $arguments"
  exit 0
}

$action = New-ScheduledTaskAction -Execute $ps -Argument $arguments -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Host "Installed and started '$TaskName'. Log: $env:APPDATA\sulti\companion.log"
Write-Host 'Check it with: Invoke-RestMethod http://127.0.0.1:7417/api/health'

