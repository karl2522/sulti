# Ends Sulti's background processes, each with everything it started (Codex, cloudflared).
# Stopping a scheduled task only ends its hidden console; the runner under it keeps going,
# so restarts and "stop" must go through this.
function Stop-SultiProcesses([ValidateSet('companion', 'tunnel', 'all')][string]$Kind = 'all') {
  $repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
  $cli = Join-Path $repo 'apps\companion\dist\cli.js'
  $rules = @()
  if ($Kind -ne 'tunnel') { $rules += @{ Name = 'powershell.exe'; Like = '*run-companion.ps1*' }, @{ Name = 'node.exe'; Like = "*$cli*start*" } }
  if ($Kind -ne 'companion') { $rules += @{ Name = 'powershell.exe'; Like = '*run-tunnel.ps1*' }, @{ Name = 'cloudflared.exe'; Like = '*--token-file*sulti*tunnel-token*' } }
  foreach ($p in Get-CimInstance Win32_Process) {
    if ($p.ProcessId -eq $PID -or -not $p.CommandLine) { continue }
    foreach ($r in $rules) {
      # Through cmd so "not found" (already ended with an earlier tree) can't trip -ErrorAction Stop.
      if ($p.Name -eq $r.Name -and $p.CommandLine -like $r.Like) { $null = & cmd.exe /d /c "taskkill /F /T /PID $($p.ProcessId) >nul 2>&1"; break }
    }
  }
}
