<#
.SYNOPSIS
  Start the Sulti companion automatically when you log on to Windows.

.DESCRIPTION
  Registers a scheduled task named "Sulti companion" that runs
  run-companion.ps1 hidden at logon, as you (so TTS and "copy to PC" reach
  your desktop). The runner restarts the companion if it exits.

  It also puts a "Sulti pairing" shortcut on your desktop. It opens a QR code
  that pairs a phone, and only works on this PC.

  If %APPDATA%\sulti\tunnel-token exists (your Cloudflare Tunnel token), it also
  registers "Sulti tunnel", which keeps cloudflared connected the same way. No
  administrator rights or Windows service needed.

  Build first (npm run build). Run again to update (it replaces running copies);
  -Stop stops Sulti until the next logon or install; -Uninstall removes it.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\production\install-startup.ps1 -DryRun
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\production\install-startup.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\production\install-startup.ps1 -Uninstall
#>
[CmdletBinding()]
param([switch]$Uninstall, [switch]$Stop, [switch]$DryRun, [string]$NodePath)
$ErrorActionPreference = 'Stop'
$TaskName = 'Sulti companion'
$TunnelTask = 'Sulti tunnel'
$Shortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Sulti pairing.url'
. (Join-Path $PSScriptRoot 'stop.ps1')

if ($Uninstall -or $Stop) {
  if ($DryRun) { Write-Host "Would stop Sulti$(if ($Uninstall) { " and remove the scheduled tasks '$TaskName' and '$TunnelTask'" })."; exit 0 }
  foreach ($t in @($TaskName, $TunnelTask)) {
    Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
    if ($Uninstall) { Unregister-ScheduledTask -TaskName $t -Confirm:$false -ErrorAction SilentlyContinue }
  }
  if ($Uninstall) { Remove-Item -LiteralPath $Shortcut -ErrorAction SilentlyContinue }
  Stop-SultiProcesses all
  Write-Host $(if ($Uninstall) { "Stopped Sulti and removed '$TaskName' and '$TunnelTask'." } else { 'Stopped Sulti. It starts again at your next logon, or run this script without -Stop.' })
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
# conhost --headless gives the scripts a console with no window. A plain hidden PowerShell gets
# handed to Windows Terminal on Windows 11 and shows up as a window; closing it stops Sulti.
$conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
$arguments = "--headless `"$ps`" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runner`" -Node `"$node`""
$user = "$env:USERDOMAIN\$env:USERNAME"
$dataDir = if ($env:SULTI_DATA_DIR) { $env:SULTI_DATA_DIR } else { Join-Path $env:APPDATA 'sulti' }
$tunnel = $null
if (Test-Path -LiteralPath (Join-Path $dataDir 'tunnel-token')) {
  $cf = (Get-Command cloudflared.exe -ErrorAction Stop).Source
  $tunnel = "--headless `"$ps`" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'run-tunnel.ps1')`" -Cloudflared `"$cf`""
}

if ($DryRun) {
  Write-Host "Task:    $TaskName (at logon of $user)"
  Write-Host "Runs:    $conhost $arguments"
  if ($tunnel) { Write-Host "Task:    $TunnelTask"; Write-Host "Runs:    $conhost $tunnel" } else { Write-Host "No tunnel-token file, so no tunnel task." }
  exit 0
}

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$tasks = @{ $TaskName = $arguments }
if ($tunnel) { $tasks[$TunnelTask] = $tunnel }
foreach ($name in $tasks.Keys) { Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue }
Stop-SultiProcesses all
foreach ($name in $tasks.Keys) {
  $action = New-ScheduledTaskAction -Execute $conhost -Argument $tasks[$name] -WorkingDirectory $repo
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  Start-ScheduledTask -TaskName $name
  Write-Host "Installed and started '$name'."
}
$hookPort = 7418
$configFile = Join-Path $dataDir 'config.json'
if (Test-Path -LiteralPath $configFile) { $c = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json; if ($c.hookPort) { $hookPort = $c.hookPort } }
if ($env:SULTI_HOOK_PORT) { $hookPort = $env:SULTI_HOOK_PORT }
Set-Content -LiteralPath $Shortcut -Encoding ASCII -Value "[InternetShortcut]`r`nURL=http://127.0.0.1:$hookPort/pair"
Write-Host "Desktop shortcut 'Sulti pairing' opens a QR code to pair a phone."
Write-Host "Logs: $dataDir\companion.log$(if ($tunnel) { ' and tunnel.log' })"
Write-Host 'Check it with: Invoke-RestMethod http://127.0.0.1:7417/api/health'
