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

# --- optional: age-restricted video support (browser cookie auth + EJS challenge solver) ---
# Engine coverage: Chromium/Blink -> named browsers (google-chrome, microsoft-edge, brave-browser,
# vivaldi, opera, chromium); Gecko/Firefox (incl. SpiderMonkey forks: Zen, LibreWolf, Waterfox,
# Floorp) -> "firefox:<profile path>"; WebKit -> safari (macOS only).
say ""
read -r -p "Set up age-restricted video downloads (browser cookie auth)? [Y/n] " ans
case "$ans" in
[nN]*)
  say "[auth] skipped - age-restricted videos will be flagged AGE-RESTRICTED (fixable later, see SKILL.md)." "$GRAY"
  ;;
*)
  # EJS solver for pip-installed yt-dlp (bundled exe builds don't need it); non-fatal if unavailable
  if have pip3; then
    pip3 install -U "yt-dlp[default]" >/dev/null 2>&1 || pip3 install --break-system-packages -U "yt-dlp[default]" >/dev/null 2>&1 || true
  elif have pip; then pip install -U "yt-dlp[default]" >/dev/null 2>&1 || true
  fi
  FOUND=()
  for b in google-chrome microsoft-edge brave-browser vivaldi opera chromium; do
    [ -d "$HOME/.config/$b" ] && FOUND+=("$b")
  done
  if [ "$(uname)" = "Darwin" ]; then
    [ -d "$HOME/Library/Application Support/Google/Chrome" ] && FOUND+=("chrome")
    [ -d "$HOME/Library/Safari" ] && FOUND+=("safari") # WebKit
  fi
  # Gecko-based: firefox adapter + profile path (any fork)
  GECKO_DIRS="$HOME/.mozilla/firefox $HOME/.zen $HOME/.librewolf $HOME/.waterfox $HOME/.floorp"
  [ "$(uname)" = "Darwin" ] && GECKO_DIRS="$GECKO_DIRS $HOME/Library/Application Support/Firefox $HOME/Library/Application Support/zen"
  for d in $GECKO_DIRS; do
    [ -d "$d" ] || continue
    p=$(find "$d" -mindepth 1 -maxdepth 1 -type d -exec test -f "{}/cookies.sqlite" \; -print 2>/dev/null | head -1)
    [ -n "$p" ] && FOUND+=("firefox:$p")
  done
  if [ "${#FOUND[@]}" -eq 0 ]; then
    say "[auth] no supported browser found - export cookies.txt manually instead (see SKILL.md)." "$YELLOW"
  else
    say "[auth] browsers with supported cookie engines found:" "$CYAN"
    i=1; for s in "${FOUND[@]}"; do say "  $i. $s"; i=$((i+1)); done
    read -r -p "Use which one for YouTube? [1] " pick
    n=${pick:-1}
    case "$n" in ''|*[!0-9]*) n=1 ;; esac
    if [ "$n" -lt 1 ] || [ "$n" -gt "${#FOUND[@]}" ]; then n=1; fi
    spec=${FOUND[$((n-1))]}
    printf '%s\n' "$spec" > "$REPO/soundtech/cookie-spec.txt"
    for t in ${TARGETS[@]:-}; do [ -n "$t" ] && printf '%s\n' "$spec" > "$t/soundtech/cookie-spec.txt"; done
    say "[auth] '$spec' written to cookie-spec.txt - age-restricted downloads now work. Keep this file private (gitignored)." "$GREEN"
  fi
  ;;
esac

say ""
say "Done. Restart/reload your agent, then use /soundtech <url> or /soundtech <song>_<artist>." "$CYAN"
