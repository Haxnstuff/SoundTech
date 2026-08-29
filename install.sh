#!/usr/bin/env bash
# SoundTech / soundtech installer — Linux / macOS / Termux
set -e
REPO="$(cd "$(dirname "$0")" && pwd)"
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; GRAY='\033[0;90m'
say() { printf "${2:-}%b${NC}\n" "$1"; }
NC=''

have() { command -v "$1" >/dev/null 2>&1; }

# --- dependencies ---
if ! have node; then
  say "[deps] node missing - installing..." "$YELLOW"
  if have apt-get; then apt-get update && apt-get install -y nodejs
  elif have dnf; then dnf install -y nodejs
  elif have pacman; then pacman -S --noconfirm nodejs
  elif have brew; then brew install node
  elif have pkg; then pkg install -y nodejs
  else say "  Install node (https://nodejs.org) and re-run." "$RED"; exit 1; fi
fi
if ! have yt-dlp; then
  say "[deps] yt-dlp missing - installing..." "$YELLOW"
  if have pip3; then pip3 install -U yt-dlp || pip3 install --break-system-packages -U yt-dlp
  elif have pip; then pip install -U yt-dlp
  elif have pkg; then pkg install -y yt-dlp
  else say "  Install yt-dlp (pip install yt-dlp) and re-run." "$RED"; exit 1; fi
fi
if ! have ffmpeg; then
  say "[deps] ffmpeg missing - installing..." "$YELLOW"
  if have apt-get; then apt-get install -y ffmpeg
  elif have dnf; then dnf install -y ffmpeg
  elif have pacman; then pacman -S --noconfirm ffmpeg
  elif have brew; then brew install ffmpeg
  elif have pkg; then pkg install -y ffmpeg
  else say "  Install ffmpeg and re-run." "$RED"; exit 1; fi
fi
if ! node -e "fetch" >/dev/null 2>&1; then
  say "[deps] node >= 18 required (global fetch missing). Update node: https://nodejs.org (or: pkg upgrade nodejs / nodesource) and re-run." "$RED"
  exit 1
fi
say "[deps] node $(node --version), yt-dlp $(yt-dlp --version 2>/dev/null || echo '?'), ffmpeg OK" "$GREEN"

# --- install skill into agent skill dirs ---
TARGETS=()
[ -d "$HOME/.pi/agent" ] && TARGETS+=("$HOME/.pi/agent/skills")
[ -d "$HOME/.claude" ] && TARGETS+=("$HOME/.claude/skills")
[ -n "$CODEX_HOME" ] && TARGETS+=("$CODEX_HOME/skills")

for t in "${TARGETS[@]:-}"; do
  [ -z "$t" ] && continue
  mkdir -p "$t"
  rm -rf "$t/soundtech"
  cp -r "$REPO/soundtech" "$t/soundtech"
  say "[skill] installed to $t/soundtech" "$GREEN"
done

# --- pi prompt template (/soundtech command) ---
if [ -d "$HOME/.pi/agent" ]; then
  mkdir -p "$HOME/.pi/agent/prompts"
  cp "$REPO/soundtech/prompt-templates/soundtech.md" "$HOME/.pi/agent/prompts/soundtech.md"
  say "[pi] /soundtech command installed" "$GREEN"
fi

say ""
say "Done. Restart/reload your agent, then use /soundtech <url> or /soundtech <song>_<artist>." "$CYAN"
