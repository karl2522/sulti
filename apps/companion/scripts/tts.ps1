<#
.SYNOPSIS
  Render text to a WAV file with System.Speech (Windows PowerShell 5.1).
.EXAMPLE
  powershell.exe -NoProfile -File tts.ps1 -TextFile in.txt -OutFile out.wav -Voice "Microsoft Zira Desktop" -Rate 1
.EXAMPLE
  powershell.exe -NoProfile -File tts.ps1 -ListVoices
#>
[CmdletBinding()]
param(
  [string]$TextFile,
  [string]$OutFile,
  [string]$Voice,
  [ValidateRange(-10, 10)][int]$Rate = 0,
  [switch]$ListVoices
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  if ($ListVoices) {
    $synth.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name }
    exit 0
  }
  if (-not $TextFile -or -not $OutFile) { throw 'TextFile and OutFile are required.' }
  $text = Get-Content -Raw -Encoding UTF8 -LiteralPath $TextFile
  if ($Voice) { $synth.SelectVoice($Voice) }
  $synth.Rate = $Rate
  # 16 kHz, 16-bit mono keeps a 5-minute answer around 10 MB.
  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $tmp = "$OutFile.partial"
  $synth.SetOutputToWaveFile($tmp, $format)
  foreach ($line in ($text -split "\r?\n")) {
    if ($line.Trim()) { $synth.Speak($line) }
  }
  $synth.SetOutputToNull()
  Move-Item -LiteralPath $tmp -Destination $OutFile -Force
}
finally {
  $synth.Dispose()
}
