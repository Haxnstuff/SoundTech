# yt-dlp Playbook — rate limits, quality, speed, tagging

Hard-won operational knowledge from downloading 1000+ tracks. Read the section you need.

## Contents
1. [Rate limits and throttling](#1-rate-limits-and-throttling)
2. [Best audio quality](#2-best-audio-quality)
3. [Speed](#3-speed)
4. [Tagging and metadata (ffmpeg)](#4-tagging-and-metadata-ffmpeg)
5. [Age-restricted and unavailable videos](#5-age-restricted-and-unavailable-videos)
6. [Matching: picking the right upload](#6-matching-picking-the-right-upload)
7. [Advanced techniques](#7-advanced-techniques)
8. [Keyless metadata APIs](#8-keyless-metadata-apis)

---

## 1. Rate limits and throttling

YouTube throttles per-IP. Symptoms and handling:

| Symptom | Meaning | Action |
|---|---|---|
| `HTTP Error 403: Forbidden` on video data | soft throttle | back off ~60s, retry; try `--extractor-args "youtube:player_client=android"` |
| search/extract requests time out | search throttle | wait 60s+; reduce request rate |
| `Requested format is not available` + only storyboards (`sb0/sb1/sb2`) in `-F` | heavy soft-block on that video/IP | the video is effectively unavailable to you — find an alternate upload |
| `The page needs to be reloaded` (tv client) | client rejected | try another client |

Rules that actually matter:

- **Do NOT parallelize downloads.** More concurrent requests = more aggressive throttling. One worker, politely paced (~1s between tracks), beats 5 workers hitting 403s.
- Back off on 403/timeout: sleep 60s, then continue the queue. Re-run the whole batch later for failures — it's idempotent if you skip existing files.
- Add retries: a 3-pass approach (run → retry failures → retry again) recovers ~everything that isn't genuinely unavailable.
- `--sleep-requests 1` helps during search-heavy phases.
- Client fallback chain that works in practice: `android` client first, default client on failure. `tv`/`ios`/`web_safari`/`mweb` often return "Requested format is not available" or need PO tokens now.
- Some individual videos are stream-blocked for your IP even when the site works (only storyboard images available). Don't fight it — search for an alternate upload of the same song.
- Cookies: `--cookies-from-browser chrome|edge` usually FAILS on Windows with `Failed to decrypt with DPAPI` (Chrome 127+ app-bound encryption). Firefox/Brave work if installed and logged in. Exporting `cookies.txt` via a browser extension is the reliable path when cookies are truly needed.

## 2. Best audio quality

```
yt-dlp -x --audio-format mp3 --audio-quality 320K --no-playlist -o "OUT/%(title)s.%(ext)s" URL
```

- YouTube's best audio streams are Opus (~130–160kbps) or AAC (~128kbps); the "320K" flag sets the MP3 encode rate. You cannot get more quality than the source stream — 320K CBR is the safe, compatibility-max choice for MP3 players.
- Prefer videos from official/Topic/VEVO channels; their audio is usually the best master.
- `--audio-quality 0` (VBR ~245kbps) is marginally more efficient but some players misreport VBR duration. 320K CBR is the dependable default.

## 3. Speed

- `--flat-playlist -J URL` lists playlist entries WITHOUT resolving each video (fast). Resolve each item individually afterward for metadata.
- One search request per song: `yt-dlp --flat-playlist -J "ytsearch5:QUERY"`.
- Between songs, ~1s pacing. Between failed/throttled requests, 60s backoff.
- Full-album uploads with chapters + `--download-sections` can fetch one track from a 40-minute video in seconds (see §7).

## 4. Tagging and metadata (ffmpeg)

Retag after download so the ID3 tags carry Spotify-grade metadata (title = song title ONLY; artist + album in tags):

```
ffmpeg -y -i in.mp3 -c copy -id3v2_version 3 \
  -metadata "title=Song Title" \
  -metadata "artist=Artist One, Artist Two" \
  -metadata "album_artist=Artist One" \
  -metadata "album=Album Name" \
  out.mp3 && mv out.mp3 in.mp3
```

- `-c copy` = no re-encode, instant.
- `-id3v2_version 3` = maximum player compatibility (v2.4 breaks some car/old players).
- Multiple artists: put all in `artist`, first in `album_artist`.

Embed album art (MP3/ID3):

```
ffmpeg -y -i in.mp3 -i cover.jpg -map 0:a -map 1:v -c copy -id3v2_version 3 \
  -metadata:s:v title="Album cover" -metadata:s:v comment="Cover (front)" out.mp3
```

Verify:

```
ffprobe -v error -show_entries format=bit_rate:format_tags=title,artist,album -of default=nw=1 file.mp3
```

## 5. Age-restricted and unavailable videos

- Age gate (`Sign in to confirm your age`): **no player client bypasses it anymore** — YouTube requires sign-in for age-restricted videos since Oct 2024 (yt-dlp issue #11296). Verified empirically: `default`, `android`, `ios`, `tv`, `tv_embedded`, `web_embedded` all fail without authentication.
- **The fix is a one-time cookies.txt export** (the script picks it up automatically — see SKILL.md): in a browser signed into an age-verified YouTube account, install the "Get cookies.txt LOCALLY" extension, go to youtube.com, export `cookies.txt`, save it next to the skill as `soundtech/cookies.txt` (or pass `--cookies PATH` / set `SOUNDTECH_COOKIES`). This also sidesteps the Chrome/Edge DPAPI/app-bound-encryption problem with `--cookies-from-browser` — an exported text file never needs to decrypt the browser's cookie store.
- **Parabolic and other GUI downloaders do not help** — they are yt-dlp frontends and hit the identical wall (Parabolic itself removed browser-cookie support on Windows and recommends manual cookies.txt).
- Without cookies, the script flags such tracks `AGE-RESTRICTED` and, in search mode, tries clean (non-gated) alternate uploads first. With cookies present, age-restricted videos are downloaded directly like any other.
- Songs that exist ONLY age-gated or nowhere: check SoundCloud (`yt-dlp "scsearch5:artist song"` or direct `https://api.soundcloud.com/tracks/...` URLs — yt-dlp accepts those api URLs directly).
- Profanity in titles: YouTube search sometimes returns 0 results for it; try masked variants ("f**k") or search the album name instead.

## 6. Matching: picking the right upload

Given expected duration D (from the metadata source) and candidate uploads:

1. **Live filter** — drop candidates whose title/channel matches:
   `/\blive\b|concert|festival|unplugged|acoustic|session|karaoke|instrumental|\bcover\b|8d audio|sped up|slowed|nightcore|tribute|remix/i`
   (unless the expected title itself says Live/Remix — then don't filter that word). If everything is filtered, fall back to the unfiltered list.
2. **Duration tolerance** — accept if `|candidate - D| <= max(20s, 12% of D)`. Prefer in-tolerance candidates.
3. **Title keyword coverage** — tokenize the expected title (drop stopwords: official, video, lyric, feat, remaster...), require ≥75% coverage in the candidate title, else fall back to closest-duration.
4. Tie-break by channel: prefer `Topic`/official channels.
5. Common false positives to guard against: same artist different song (durations can be similar!), podcast/news clips that contain your keywords, instrumentals, "clean" versions (usually acceptable), full-album uploads when the song itself exists.

## 7. Advanced techniques

**Cut one track from a full-album upload:**

```
# if the video has chapters (check with -J and .chapters):
yt-dlp -x --audio-format mp3 --audio-quality 320K \
  --download-sections "*887-1110" --force-keyframes-at-cuts \
  -o "OUT/track.%(ext)s" "https://www.youtube.com/watch?v=VIDEO_ID"
```

No chapters? Estimate the boundary from Spotify track durations (intro + part1 lengths), or use `ffmpeg -af silencedetect=noise=-35dB:d=2` to find gaps, then cut with `ffmpeg -ss START -i full.mp3 -c copy -id3v2_version 3 -metadata ... out.mp3`.

**Playlist listing without downloading:**

```
yt-dlp --flat-playlist -J URL | jq '.entries[] | {id, title, duration}'
```

**Get just metadata for one video:**

```
yt-dlp -J --skip-download URL
```

Useful fields: `track`, `artist`, `album`, `title`, `duration`, `channel`, `uploader`.

**Channel upload listing (watch for throttle):**

```
yt-dlp --flat-playlist -J --playlist-end 40 "https://www.youtube.com/channel/CHANNEL_ID/videos"
```

## 8. Keyless metadata APIs

**iTunes Search** (no key, generous) — canonical title/artist/album/duration/artwork:

```
https://itunes.apple.com/search?term=SONG+ARTIST&media=music&entity=song&limit=15
```

Results: `trackName`, `artistName`, `collectionName` (album), `trackTimeMillis`, `artworkUrl100` (swap `100x100`→`600x600` for hi-res). Artwork URL is directly downloadable.

Use it to disambiguate album versions BEFORE searching YouTube, and to fill missing album metadata on URL downloads.
