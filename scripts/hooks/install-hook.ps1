<#
.SYNOPSIS
  Install (or remove) the Sulti Stop hook in your Codex config.toml.

.DESCRIPTION
  Backs up config.toml, then appends a marked [[hooks.Stop]] block that runs
  scripts\hooks\stop-hook.mjs in the background (async) after every turn.
  Running it again replaces the block; -Uninstall removes it. Review the
  printed block before you run it. After installing, restart your Codex
  terminals and trust the hook with /hooks (Codex skips untrusted hooks).

  Verified on Codex 0.165.0 (docs/PROTOCOL_NOTES.md): hook commands on Windows
  run through PowerShell, so the node path is written unquoted (8.3 short path
  if it contains spaces) and the script path is quoted.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\hooks\install-hook.ps1 -DryRun
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\hooks\install-hook.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\hooks\install-hook.ps1 -Uninstall
#>
[CmdletBinding()]
param(
  [switch]$Uninstall,
  [switch]$DryRun,
  [string]$ConfigPath,
  [string]$NodePath,
  [string]$HookScript
)
$ErrorActionPreference = 'Stop'
$Begin = '# >>> sulti stop hook >>>'
$End = '# <<< sulti stop hook <<<'

if (-not $ConfigPath) {
  $codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
  $ConfigPath = Join-Path $codexHome 'config.toml'
}

function Resolve-StableNode([string]$path) {
  if (-not $path) { $path = (Get-Command node.exe -ErrorAction Stop).Source }
  $item = Get-Item -LiteralPath $path
  # Version managers (fnm, nvm) put per-shell symlinks on PATH; follow them to the real file.
  # (Windows PowerShell 5.1 may leave LinkType empty, so check Target directly.)
  $target = @($item.Target) | Where-Object { $_ } | Select-Object -First 1
  if ($target) { $path = $target }
  return (Resolve-Path -LiteralPath $path).Path
}

function Get-HookCommand([string]$node, [string]$script) {
  if ($node -match ' ') {
    $fso = New-Object -ComObject Scripting.FileSystemObject
    $short = $fso.GetFile($node).ShortPath
    if ($short -and $short -notmatch ' ') { $node = $short }
  }
  if ($node -match ' ') {
    Write-Warning "Node path still contains spaces; using the PowerShell call operator form. Check the hook with: node stop-hook.mjs --debug"
    return "& '$node' '$script'"
  }
  return "$node `"$script`""
}

function Remove-Block([string]$text) {
  $pattern = '(?s)\r?\n?' + [regex]::Escape($Begin) + '.*?' + [regex]::Escape($End) + '\r?\n?'
  return [regex]::Replace($text, $pattern, [Environment]::NewLine)
}

$existing = if (Test-Path -LiteralPath $ConfigPath) { [System.IO.File]::ReadAllText($ConfigPath) } else { '' }
$withoutBlock = (Remove-Block $existing).TrimEnd()

if ($Uninstall) {
  $new = if ($withoutBlock) { $withoutBlock + [Environment]::NewLine } else { '' }
  $block = $null
}
else {
  if (-not $HookScript) { $HookScript = Join-Path $PSScriptRoot 'stop-hook.mjs' }
  $HookScript = (Resolve-Path -LiteralPath $HookScript).Path
  $node = Resolve-StableNode $NodePath
  $command = Get-HookCommand $node $HookScript
  if ($command.Contains("'") -and -not $command.StartsWith('&')) { throw 'Paths containing a single quote are not supported in a TOML literal string.' }
  if ($command.StartsWith('&')) { $tomlCommand = '"' + $command.Replace('\', '\\').Replace('"', '\"') + '"' } else { $tomlCommand = "'" + $command + "'" }
  $nl = [Environment]::NewLine
  $block = @(
    $Begin,
    '# Added by Sulti (scripts\hooks\install-hook.ps1). Remove with: install-hook.ps1 -Uninstall',
    '# Pure observer: prints nothing, always exits 0, runs in the background.',
    '[[hooks.Stop]]',
    '',
    '[[hooks.Stop.hooks]]',
    'type = "command"',
    "command = $tomlCommand",
    "command_windows = $tomlCommand",
    'timeout = 5',
    'async = true',
    $End
  ) -join $nl
  $new = $(if ($withoutBlock) { $withoutBlock + $nl + $nl } else { '' }) + $block + $nl
}

if ($DryRun) {
  Write-Host "Config file: $ConfigPath"
  if ($block) { Write-Host "Block that would be written:"; Write-Host $block } else { Write-Host 'The Sulti block would be removed.' }
  exit 0
}

if (Test-Path -LiteralPath $ConfigPath) {
  $backup = "$ConfigPath.sulti-backup-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
  Copy-Item -LiteralPath $ConfigPath -Destination $backup
  Write-Host "Backed up config to $backup"
}
else {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ConfigPath) | Out-Null
}
[System.IO.File]::WriteAllText($ConfigPath, $new, (New-Object System.Text.UTF8Encoding $false))
if ($Uninstall) {
  Write-Host 'Removed the Sulti Stop hook. Restart your Codex terminals.'
}
else {
  Write-Host 'Installed the Sulti Stop hook:'
  Write-Host $block
  Write-Host ''
  Write-Host 'Next: restart your Codex terminals, run /hooks in Codex, and trust the Sulti Stop hook.'
}
