---
name: soundtech
description: Download music as high-quality (320kbps) MP3s with proper ID3 tags (artist + album embedded, song title only in the title) using yt-dlp + ffmpeg. Use when the user says "/soundtech", asks to download a song, an album, a playlist URL, a YouTube/SoundCloud link, a document containing a list of songs, or asks to grab audio at best quality. Handles URLs, song+artist searches, and bulk lists.
---

# Soundtech

Download music at 320kbps MP3 with correct ID3 metadata using the bundled script. Requires `node`, `yt-dlp`, `ffmpeg` on PATH.

## The script

`scripts/soundtech.mjs` — run it with node from any directory. All commands below assume:

```
node <path-to-this-skill>/scripts/soundtech.mjs <args> --out <output-dir>
```

Flags: `--out DIR` (or `$SOUNDTECH_OUT`), `--cookies PATH` (or `cookies.txt` in the skill folder), `--ask`/`--pick N` (candidate selection).

Default output dir: `$SOUNDTECH_OUT` env var or `./soundtech-downloads`. Always pass `--out` if the user names a destination folder.

## Mode 1: URL

```
node scripts/soundtech.mjs "https://youtube.com/watch?v=..." --out DIR
```

- Works for single videos AND playlists/albums (all entries downloaded and tagged).
- Multiple URLs in one call are fine.
- Metadata (title/artist) comes from yt-dlp; missing album is filled from the iTunes Search API, and album art is embedded when available.
- For pages that are NOT direct media links (Google Docs, pastebin, blog tracklists, forums): fetch the page with your own tools, extract the song list into a text file with one `Song - Artist` per line, then use list mode.

## Mode 2: song + artist search

```
node scripts/soundtech.mjs --search "Song Name" "Artist" --out DIR
```

Also accepts `--search "Song Name_Artist"` (underscore or ` - ` separator).

Metadata (exact title, artist, album, duration, album art) comes from the iTunes Search API; the YouTube match is verified by duration tolerance + title keyword coverage, and live/concert/acoustic/karaoke/etc. versions are filtered out.

**When multiple album versions exist, you MUST let the user choose (unless they said otherwise).** Run with `--ask`:

```
node scripts/soundtech.mjs --search "Song Name" "Artist" --ask --out DIR
```

- If exactly one version matches, it downloads immediately.
- If multiple versions exist, the script prints `SOUNDTECH_ASK {...}` with numbered candidates and exits with code 2 (on a TTY it shows an interactive picker instead). Show the candidates to the user in your own UI, get their pick(s), then re-run with `--pick 1,3` (numbers from the listing). Multiple picks download all selected versions. `--pick` resolves only the next ambiguous song — in list mode, subsequent ambiguous songs exit 2 again.

## Mode 3: bulk list

```
node scripts/soundtech.mjs --list songs.txt --out DIR
```

One `Song - Artist` per line (`Song_Artist` also works, `#` lines skipped). Each line goes through search mode. With `--ask`, the script stops with exit 2 at the first ambiguous line — resolve it with `--pick`, then re-run (already-downloaded songs are skipped automatically, so re-running is safe and cheap).

## One-time setup: age-restricted videos

YouTube requires sign-in for age-restricted videos (no client trick works). To unlock them, export cookies **once**:

1. In a browser signed into your (age-verified) YouTube account, install the **"Get cookies.txt LOCALLY"** extension.
2. Go to https://youtube.com, click the extension, **Export** (Netscape format).
3. Save the file as `cookies.txt` in this skill's folder (`<skill-dir>/soundtech/cookies.txt`).

The script then picks it up automatically for every download. Alternatives: `--cookies PATH` or the `SOUNDTECH_COOKIES` env var. Keep the file private — it contains your session credentials (it's gitignored).

Without a cookies file, age-restricted tracks are logged `AGE-RESTRICTED` (search mode still tries non-gated alternate uploads first).

## After any run

**Exit codes:** `0` = everything downloaded (or already existed) · `1` = one or more failures (or usage error — read the log) · `2` = decision needed: `SOUNDTECH_ASK` JSON was printed on stdout; ask the user and re-run with `--pick`.

- The script logs to `DIR/soundtech.log`. Read it to report OK/FAIL/SKIP counts.
- Failures to recognize and handle:
  - `AGE-RESTRICTED` → one-time fix: export cookies.txt per the setup section above (a browser-encrypted `--cookies-from-browser` export often fails to decrypt on Chrome/Edge — see playbook).
  - `403 / timeout` → YouTube is throttling the IP. Wait 60s and retry; do NOT increase parallelism (it makes throttling worse).
  - Re-running any mode is idempotent — existing files are skipped.

## Verification (do this before saying "done")

For every downloaded file confirm tags and bitrate:

```
ffprobe -v error -show_entries format=bit_rate:format_tags=title,artist,album -of default=nw=1 "FILE.mp3"
```

Expect `bit_rate=320...`, `title` = song title only, `artist` and `album` populated.

## Deep dive

For rate-limit handling, best-quality/source-format details, tagging recipes, age-gate workarounds, SoundCloud fallbacks, and chapter-cutting techniques, read [references/yt-dlp-playbook.md](references/yt-dlp-playbook.md).
