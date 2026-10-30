<#
.SYNOPSIS
  Keep the Sulti companion running in the background, restarting it if it exits.

.DESCRIPTION
  Started at logon by install-startup.ps1 (hidden). Output goes to
  %APPDATA%\sulti\companion.log; the previous run is kept as companion.log.old.
  In the background the companion never prints pairing codes. Pair a phone
  with "npm run pair" from the Sulti folder.
#>
param([Parameter(Mandatory = $true)][string]$Node)
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$cli = Join-Path $repo 'apps\companion\dist\cli.js'
$dataDir = if ($env:SULTI_DATA_DIR) { $env:SULTI_DATA_DIR } else { Join-Path $env:APPDATA 'sulti' }
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$log = Join-Path $dataDir 'companion.log'
$err = Join-Path $dataDir 'companion.err.log'

while ($true) {
  if (Test-Path -LiteralPath $log) { Move-Item -Force -LiteralPath $log -Destination "$log.old" }
  $p = Start-Process -FilePath $Node -ArgumentList @("`"$cli`"", 'start') -WorkingDirectory $repo -NoNewWindow -PassThru -Wait -RedirectStandardOutput $log -RedirectStandardError $err
  Add-Content -LiteralPath $log -Value "$(Get-Date -Format s) companion exited with code $($p.ExitCode); restarting in 5 s"
  Start-Sleep -Seconds 5
}

