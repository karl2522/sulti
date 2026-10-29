<#
.SYNOPSIS
  Start a shared Codex app-server on loopback that several clients can attach to:
  the Sulti companion (mode "shared"), a TUI with --remote, and the T5 test.

.DESCRIPTION
  Creates a capability-token file in the Sulti data folder (once) and runs
    codex app-server --listen ws://127.0.0.1:<Port> --ws-auth capability-token --ws-token-file <abs path>
  The WebSocket transport is experimental. The listener is loopback only; never
  expose it through Tailscale or a port forward.

.EXAMPLE
  pwsh tools/shared-session/start-server.ps1
  # in another terminal, attach a TUI:
  $env:SULTI_CODEX_TOKEN = Get-Content "$env:APPDATA\sulti\app-server-token" -Raw
  codex --remote ws://127.0.0.1:4500 --remote-auth-token-env SULTI_CODEX_TOKEN
#>
param(
  [int]$Port = 4500,
  [string]$DataDir = $(if ($env:SULTI_DATA_DIR) { $env:SULTI_DATA_DIR } else { Join-Path $env:APPDATA 'sulti' }),
  [switch]$NewToken
)
$ErrorActionPreference = 'Stop'

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$tokenFile = [System.IO.Path]::GetFullPath((Join-Path $DataDir 'app-server-token'))

if ($NewToken -or -not (Test-Path -LiteralPath $tokenFile)) {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $token = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  # No trailing newline: the server compares the file content.
  [System.IO.File]::WriteAllText($tokenFile, $token)
  Write-Host "Created a new capability token in $tokenFile"
}

$codex = Get-Command codex -ErrorAction SilentlyContinue
if (-not $codex) { throw 'codex is not on PATH. Install the Codex CLI first (codex --version).' }

Write-Host "Shared app-server: ws://127.0.0.1:$Port (loopback only). Ctrl+C to stop."
Write-Host 'Attach a TUI from another terminal with:'
Write-Host "  `$env:SULTI_CODEX_TOKEN = Get-Content '$tokenFile' -Raw"
Write-Host "  codex --remote ws://127.0.0.1:$Port --remote-auth-token-env SULTI_CODEX_TOKEN"
Write-Host 'Point the companion at it with "mode": "shared" in config.json (see docs/MANUAL_TESTS.md).'

& codex app-server --listen "ws://127.0.0.1:$Port" --ws-auth capability-token --ws-token-file $tokenFile
