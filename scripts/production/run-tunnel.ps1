<#
.SYNOPSIS
  Keep the Cloudflare Tunnel for Sulti running in the background, restarting it if it exits.

.DESCRIPTION
  Started at logon by install-startup.ps1 (hidden) when %APPDATA%\sulti\tunnel-token
  exists. The token is read from that file, so it never appears on a command line.
  Log: %APPDATA%\sulti\tunnel.log (the previous run is kept as tunnel.log.old).
#>
param([Parameter(Mandatory = $true)][string]$Cloudflared)
$dataDir = if ($env:SULTI_DATA_DIR) { $env:SULTI_DATA_DIR } else { Join-Path $env:APPDATA 'sulti' }
$token = Join-Path $dataDir 'tunnel-token'
$log = Join-Path $dataDir 'tunnel.log'

# A restart (Stop-/Start-ScheduledTask) leaves the previous runner and cloudflared running.
. (Join-Path $PSScriptRoot 'stop.ps1')
Stop-SultiProcesses tunnel

while ($true) {
  if (Test-Path -LiteralPath $log) { Move-Item -Force -LiteralPath $log -Destination "$log.old" }
  $p = Start-Process -FilePath $Cloudflared -ArgumentList @('tunnel', '--no-autoupdate', '--logfile', "`"$log`"", 'run', '--token-file', "`"$token`"") -NoNewWindow -PassThru -Wait
  Add-Content -LiteralPath $log -Value "$(Get-Date -Format s) cloudflared exited with code $($p.ExitCode); restarting in 5 s"
  Start-Sleep -Seconds 5
}
