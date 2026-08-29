# SoundTech / soundtech installer — Windows
# Usage: powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = "Stop"
$repo = $PSScriptRoot

function Test-Cmd($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

# --- dependencies ---
if (-not (Test-Cmd node)) {
  Write-Host "[deps] node missing - installing via winget..." -ForegroundColor Yellow
  winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  if (-not (Test-Cmd node)) { Write-Host "  node still missing; install from https://nodejs.org and re-run." -ForegroundColor Red; exit 1 }
}
if (-not (Test-Cmd yt-dlp)) {
  Write-Host "[deps] yt-dlp missing - installing via winget..." -ForegroundColor Yellow
  winget install yt-dlp.yt-dlp --accept-source-agreements --accept-package-agreements
  if (-not (Test-Cmd yt-dlp)) { Write-Host "  yt-dlp still missing; install from https://github.com/yt-dlp/yt-dlp#installation and re-run." -ForegroundColor Red; exit 1 }
}
if (-not (Test-Cmd ffmpeg)) {
  Write-Host "[deps] ffmpeg missing - installing via winget..." -ForegroundColor Yellow
  winget install Gyan.FFmpeg --accept-source-agreements --accept-package-agreements
  if (-not (Test-Cmd ffmpeg)) { Write-Host "  ffmpeg still missing; install from https://www.gyan.dev/ffmpeg/builds/ and re-run." -ForegroundColor Red; exit 1 }
}
node -e "fetch" 2>$null
if ($LASTEXITCODE -ne 0) { Write-Host "[deps] node >= 18 required (global fetch missing). Update node from https://nodejs.org and re-run." -ForegroundColor Red; exit 1 }
Write-Host "[deps] node $(node --version), yt-dlp $(yt-dlp --version), ffmpeg OK" -ForegroundColor Green

# --- install skill into agent skill dirs ---
$targets = @(
  "$env:USERPROFILE\.pi\agent\skills",
  "$env:USERPROFILE\.claude\skills"
)
if ($env:CODEX_HOME) { $targets += "$env:CODEX_HOME\skills" }

foreach ($t in $targets) {
  if (Test-Path (Split-Path $t)) {
    $dest = Join-Path $t "soundtech"
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    Copy-Item "$repo\soundtech" $dest -Recurse
    Write-Host "[skill] installed to $dest" -ForegroundColor Green
  } else {
    Write-Host "[skill] skip (no agent dir): $t" -ForegroundColor DarkGray
  }
}

# --- pi prompt template (/soundtech command) ---
$piPrompts = "$env:USERPROFILE\.pi\agent\prompts"
if (Test-Path "$env:USERPROFILE\.pi\agent") {
  New-Item -ItemType Directory -Force -Path $piPrompts | Out-Null
  Copy-Item "$repo\soundtech\prompt-templates\soundtech.md" $piPrompts -Force
  Write-Host "[pi] /soundtech command installed to $piPrompts" -ForegroundColor Green
}

Write-Host ""
Write-Host "Done. Restart/reload your agent, then use /soundtech <url> or /soundtech <song>_<artist>." -ForegroundColor Cyan
