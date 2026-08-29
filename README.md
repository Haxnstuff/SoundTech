# SoundTech / soundtech

A universal agent skill that downloads music as **320kbps MP3s with proper ID3 tags** — artist(s) and album embedded in the tags, song title only in the title — using `yt-dlp` + `ffmpeg`. Works from any AI coding CLI (pi, Claude Code, Codex, Cursor, ...) or plain shell.

## What it does

| Command | Behavior |
|---|---|
| `/soundtech <url>` | Downloads the audio from a video/playlist URL at 320kbps and tags it. If the URL is a playlist, downloads everything in it. If the URL is a document containing a list of songs (Google Doc, pastebin, tracklist), the agent extracts the list and downloads all of them. |
| `/soundtech <song-name>_<artist>` | Looks the song up (exact title/artist/album/duration/artwork via the keyless iTunes Search API), searches YouTube, verifies the match (duration tolerance + title coverage), filters out live/concert/karaoke/nightcore versions, and downloads. If multiple album versions exist, **you are asked which to download** — multiple picks allowed. |

Every file: `320kbps CBR MP3` · ID3v2.3 `title` = song title only · `artist` = all artists · `album` + `album_artist` · album art embedded when available.

## Install

### Windows (PowerShell)

```powershell
git clone https://github.com/Haxnstuff/SoundTech.git
cd SoundTech
./install.ps1
```

### Linux / macOS / Termux (bash)

```bash
git clone https://github.com/Haxnstuff/SoundTech.git
cd SoundTech
chmod +x install.sh && ./install.sh
```

Both installers:
1. Install missing dependencies (`node`, `yt-dlp`, `ffmpeg`) via your platform's package manager.
2. Copy the `soundtech/` skill into every detected agent skill directory (`~/.pi/agent/skills`, `~/.claude/skills`, `$CODEX_HOME/skills` if present).
3. For pi: also install the `/soundtech` prompt template so the command exists verbatim.

Then restart/reload your agent.

### Manual

Copy the `soundtech/` folder into your agent's skills directory. Requirements: `node >= 18`, `yt-dlp`, `ffmpeg` on PATH.

## Using it

In any agent: just say `/soundtech <url>` or `/soundtech <song>_<artist>`, or describe what you want ("download this playlist at 320kbps"). In a plain shell:

```bash
node soundtech/scripts/soundtech.mjs "https://youtube.com/watch?v=..." --out ./music
node soundtech/scripts/soundtech.mjs --search "Dreams" "Fleetwood Mac" --ask --out ./music
node soundtech/scripts/soundtech.mjs --list songs.txt --out ./music
```

`--ask` makes the script print numbered candidates and exit (code 2) when several album versions match; the agent shows them to you and re-runs with `--pick 1,3`. Re-running is always safe — existing files are skipped.

## What's in the box

```
soundtech/
├── SKILL.md                          # agent-facing instructions (any CLI)
├── prompt-templates/soundtech.md     # pi /soundtech command
├── scripts/soundtech.mjs             # the downloader (node stdlib only, no npm deps)
└── references/yt-dlp-playbook.md     # rate limits, quality, speed, tagging, workarounds
```

`references/yt-dlp-playbook.md` documents everything the hard way: YouTube rate-limit patterns and backoff rules, why parallel downloads make things worse, audio quality reality (source streams are ~128–160kbps; 320K CBR is the compatibility-max encode), the ffmpeg tagging/cover-art recipes, age-restriction workarounds, SoundCloud fallbacks, full-album chapter cutting, and upload-matching heuristics. Any agent (or human) operating yt-dlp at scale should read it.

## Notes

- YouTube throttles per IP — the skill runs single-worker with pacing and automatic 60s backoff. Big playlists take time; that's the network, not the tool.
- Age-restricted videos can't be downloaded without browser cookies; the script automatically finds clean alternate uploads instead.
- Re-runs are idempotent: anything already downloaded is skipped.
