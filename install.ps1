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

# --- optional: age-restricted video support (browser cookie auth + EJS challenge solver) ---
# Cookie-adapter coverage: Chromium/Blink -> named browsers (chrome, edge, brave, vivaldi, opera,
# chromium, whale); Gecko/Firefox (incl. SpiderMonkey forks: Zen, LibreWolf, Waterfox, Floorp) ->
# "firefox:<profile path>" (forks are not known names); WebKit -> safari (macOS only).
Write-Host ""
$ans = Read-Host "Set up age-restricted video downloads (browser cookie auth)? [Y/n]"
if ($ans -match '^[Nn]') {
  Write-Host "[auth] skipped - age-restricted videos will be flagged AGE-RESTRICTED (fixable later, see SKILL.md)." -ForegroundColor DarkGray
} else {
  if (Test-Cmd pip3) { pip3 install -U "yt-dlp[default]" 2>$null | Out-Null }
  elseif (Test-Cmd pip) { pip install -U "yt-dlp[default]" 2>$null | Out-Null } # exe builds bundle yt-dlp-ejs already
  $found = [System.Collections.Generic.List[string]]::new()
  $chromium = [ordered]@{
    chrome   = "$env:LOCALAPPDATA\Google\Chrome\User Data"; edge = "$env:LOCALAPPDATA\Microsoft\Edge\User Data"
    brave    = "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\User Data"; vivaldi = "$env:LOCALAPPDATA\Vivaldi\User Data"
    opera    = "$env:APPDATA\Opera Software"; chromium = "$env:LOCALAPPDATA\Chromium\User Data"
    whale    = "$env:LOCALAPPDATA\Naver\Whale\User Data"
  }
  foreach ($k in $chromium.Keys) { if (Test-Path $chromium[$k]) { $found.Add($k) } }
  $gecko = [ordered]@{
    firefox = "$env:APPDATA\Mozilla\Firefox\Profiles"; zen = "$env:APPDATA\zen\Profiles"
    librewolf = "$env:APPDATA\librewolf\Profiles"; waterfox = "$env:APPDATA\Waterfox\Profiles"; floorp = "$env:APPDATA\Floorp\Profiles"
  }
  foreach ($k in $gecko.Keys) {
    $p = Get-ChildItem $gecko[$k] -Directory -ErrorAction SilentlyContinue |
         Where-Object { Test-Path (Join-Path $_.FullName "cookies.sqlite") } | Select-Object -First 1
    if ($p) { $found.Add("firefox:$($p.FullName)") } # all Gecko forks use the firefox adapter
  }
  if (-not $found.Count) {
    Write-Host "[auth] no supported browser found - export cookies.txt manually instead (see SKILL.md)." -ForegroundColor Yellow
  } else {
    Write-Host "[auth] browsers with supported cookie engines found:" -ForegroundColor Cyan
    for ($i = 0; $i -lt $found.Count; $i++) { Write-Host "  $($i+1). $($found[$i])" }
    $pick = Read-Host "Use which one for YouTube? [1]"
    $n = 1; [void][int32]::TryParse($pick, [ref]$n); if ($n -lt 1 -or $n -gt $found.Count) { $n = 1 }
    $spec = $found[$n - 1]
    $specTargets = @("$repo\soundtech\cookie-spec.txt") +
      ($targets | Where-Object { Test-Path (Split-Path $_) } | ForEach-Object { Join-Path $_ "soundtech\cookie-spec.txt" })
    foreach ($s in $specTargets) { Set-Content -Path $s -Value $spec -Encoding utf8 }
    Write-Host "[auth] '$spec' written to cookie-spec.txt - age-restricted downloads now work. Keep this file private (gitignored)." -ForegroundColor Green
  }
}

Write-Host ""
Write-Host "Done. Restart/reload your agent, then use /soundtech <url> or /soundtech <song>_<artist>." -ForegroundColor Cyan
