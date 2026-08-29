---
description: Download music at 320kbps MP3 with proper ID3 tags (soundtech)
argument-hint: [url] or [song-name]_[artist]
---
Use the `soundtech` skill to download: $ARGUMENTS

Rules:
- If the argument is a URL, run the skill's URL mode. If the URL is a page/document containing a list of songs (Google Doc, paste, tracklist) rather than direct media, extract the list and use the skill's list mode.
- If the argument is `song-name_artist`, run the skill's search mode with `--ask`. If the script exits with code 2 and prints `SOUNDTECH_ASK`, show the candidate list to me and ask which to download (multiple selections allowed), then re-run with `--pick`.
- Output to the directory I specify, or `./soundtech-downloads` if I don't.
- After downloading, verify tags and bitrate with ffprobe and report OK/FAIL counts.
