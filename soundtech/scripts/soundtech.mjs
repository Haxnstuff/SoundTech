#!/usr/bin/env node
// soundtech — download music at best quality (320kbps MP3) with proper ID3 tags (artist + album, title-only title).
//
// Usage:
//   node soundtech.mjs <url> [url2 ...] [--out DIR]              # URL(s): single video or playlist
//   node soundtech.mjs --search "Song Name" "Artist" [flags]     # look up + download a song
//   node soundtech.mjs --search "Song Name_Artist" [flags]       # _ or " - " separates song from artist
//   node soundtech.mjs --list songs.txt [--out DIR]              # one "Song - Artist" (or "Song_Artist") per line
//
// Flags:
//   --out DIR     output directory (default: $SOUNDTECH_OUT or ./soundtech-downloads)
//   --ask         when multiple album versions are found: print them as JSON on stdout and exit(2),
//                 so a calling agent can ask the user and re-run with --pick (script has no TTY in agent shells)
//   --pick 1,3    select candidate number(s) from a previous --ask listing
//   --auto        never prompt; pick the best candidate (default when not interactive)
//
// Requires on PATH: node >= 18, yt-dlp, ffmpeg.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, renameSync, statSync, unlinkSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";

// ---------- args ----------
const argv = process.argv.slice(2);
function flagVal(name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; }
const has = (name) => argv.includes(name);
const OUT = path.resolve(flagVal("--out") || process.env.SOUNDTECH_OUT || "soundtech-downloads");
const ASK = has("--ask");
let PICK = flagVal("--pick"); // consumed by the first ambiguous song it resolves (list mode)
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--out" || argv[i] === "--pick" || argv[i] === "--list") { i++; continue; }
  if (argv[i].startsWith("--")) continue;
  positional.push(argv[i]);
}
const listFile = has("--list") ? flagVal("--list") : positional.find((a) => a.toLowerCase().endsWith(".txt"));
const urls = positional.filter((a) => /^https?:\/\//i.test(a));

mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, "soundtech.log");
function log(line) { appendFileSync(LOG, `[${new Date().toISOString()}] ${line}\n`); console.log(line); }
function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function run(cmd, args, opts = {}) {
  // maxBuffer: large playlist JSON (-J) easily exceeds the 1 MiB default
  return execFileSync(cmd, args, { encoding: "utf8", timeout: 300000, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, ...opts });
}

const LIVE_RE = /\blive\b|concert|festival|unplugged|acoustic|session|karaoke|instrumental|\bcover\b|8d audio|sped up|slowed|nightcore|tribute|remix/i;
const STOPWORDS = new Set(["feat", "ft", "official", "video", "audio", "lyric", "lyrics", "hd", "mv", "music", "remaster", "remastered", "version", "single", "radio", "edit", "of", "the", "a", "an", "and", "in", "on", "with", "from", "to", "by"]);

function words(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter((w) => w.length >= 2 && !STOPWORDS.has(w.replace(/'s$/, "")));
}
function coverage(title, candTitle) {
  const tw = words(title);
  if (!tw.length) return 0;
  const cw = new Set(words(candTitle));
  return tw.filter((w) => cw.has(w)).length / tw.length;
}
function sanitize(s) {
  let out = (s || "").replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, " ").replace(/[. ]+$/, "").trim().slice(0, 180);
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(out)) out = "_" + out; // Windows reserved device names
  return out;
}
function norm(s) { return (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); }

// ---------- song metadata: iTunes Search API (free, keyless) ----------
async function itunesSearch(term, limit = 15) {
  try {
    const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=${limit}`);
    if (!res.ok) return [];
    const j = await res.json();
    return (j.results || []).map((r) => ({
      title: r.trackName,
      artist: r.artistName,
      album: r.collectionName || null,
      duration_s: r.trackTimeMillis ? r.trackTimeMillis / 1000 : 0,
      artwork: r.artworkUrl100 ? r.artworkUrl100.replace(/100x100/, "600x600") : null,
    }));
  } catch { return []; }
}
function metaMatches(cands, song, artist) {
  const sn = norm(song), an = norm(artist);
  const seen = new Set();
  const out = [];
  for (const c of cands) {
    const tn = norm(c.title), rtn = norm(c.artist);
    const songOk = tn.includes(sn) || sn.includes(tn) || coverage(song, c.title) >= 0.7;
    const artOk = !an || rtn.includes(an) || an.includes(rtn) || rtn.split(" ").some((w) => w.length > 2 && an.includes(w));
    if (songOk && artOk) {
      const key = `${c.title}|${c.album}`;
      if (!seen.has(key)) { seen.add(key); out.push(c); }
    }
  }
  return out;
}

// ---------- youtube search + pick ----------
function ytSearch(query, n = 5) {
  try {
    const out = run("yt-dlp", ["--flat-playlist", "-J", "--no-warnings", `ytsearch${n}:${query}`], { timeout: 60000 });
    return (JSON.parse(out).entries || []).map((e) => ({
      id: e.id, title: e.title || "",
      dur: typeof e.duration === "number" ? e.duration : Infinity,
      channel: e.channel || e.uploader || "",
    }));
  } catch { return []; }
}
function pickCandidate(cands, dur, title) {
  if (!cands.length) return null;
  const clean = cands.filter((c) => !LIVE_RE.test(c.title) && !LIVE_RE.test(c.channel));
  const pool = clean.length ? clean : cands;
  const tol = Math.max(20, 0.12 * dur);
  const scored = pool.map((c) => ({ ...c, diff: Math.abs(c.dur - dur), cov: coverage(title, c.title) }));
  const inTol = scored.filter((c) => c.diff <= tol);
  const from = inTol.length ? inTol : scored;
  const bestCov = from.filter((c) => c.cov >= 0.75);
  const list = bestCov.length ? bestCov : from;
  list.sort((a, b) => a.diff - b.diff || b.cov - a.cov || (b.channel.includes("Topic") ? 1 : 0) - (a.channel.includes("Topic") ? 1 : 0));
  const best = list[0];
  return best.diff <= tol || best.cov >= 0.75 ? best : null;
}

// ---------- download + tag ----------
function downloadYouTube(ytId, outBase) {
  const base = ["-x", "--audio-format", "mp3", "--audio-quality", "320K", "--no-playlist", "--no-warnings", "--quiet",
    "-o", `${outBase}.%(ext)s`, `https://www.youtube.com/watch?v=${ytId}`];
  try {
    run("yt-dlp", ["--extractor-args", "youtube:player_client=android", ...base]);
  } catch {
    run("yt-dlp", base); // fallback: default client
  }
}
// yt-dlp sometimes exits 0 but leaves a corrupt stub (stream-blocked videos). Validate hard.
function validMp3(file) {
  try {
    if (!existsSync(file) || statSync(file).size < 50000) return false;
    const dur = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).trim());
    return dur > 5;
  } catch { return false; }
}
function probeAge(id) {
  try {
    const out = run("yt-dlp", ["--skip-download", "--no-warnings", "--print", "%(age_limit)s", `https://www.youtube.com/watch?v=${id}`], { timeout: 60000 });
    return parseInt(out.trim()) || 0;
  } catch { return -1; }
}
function tag(file, meta, artworkPath) {
  // force 320kbps: yt-dlp skips re-encoding when the source is already mp3 (possibly low bitrate)
  let br = 0;
  try { br = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=bit_rate", "-of", "csv=p=0", file], { encoding: "utf8" }).trim()); } catch {}
  const reencode = br > 0 && br < 300000;
  const tmp = file.replace(/\.mp3$/, ".tag.mp3");
  const fargs = ["-y", "-v", "error", "-i", file];
  const hasArt = artworkPath && existsSync(artworkPath);
  if (hasArt) fargs.push("-i", artworkPath, "-map", "0:a", "-map", "1:v");
  fargs.push("-id3v2_version", "3",
    "-metadata", `title=${meta.title}`,
    "-metadata", `artist=${meta.artist}`,
    "-metadata", `album_artist=${meta.artist.split(",")[0].trim()}`);
  if (meta.album) fargs.push("-metadata", `album=${meta.album}`);
  if (reencode) fargs.push("-c:a", "libmp3lame", "-b:a", "320k");
  else fargs.push("-c:a", "copy");
  if (hasArt) fargs.push("-c:v", "copy", "-metadata:s:v", "title=Album cover", "-metadata:s:v", "comment=Cover (front)");
  fargs.push(tmp);
  run("ffmpeg", fargs);
  renameSync(tmp, file);
}
async function fetchArtwork(url, dest) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) return null;
    writeFileSync(dest, buf);
    return dest;
  } catch { return null; }
}

// ---------- search mode ----------
async function searchAndDownload(song, artist) {
  artist = artist || "";
  const cands = metaMatches(await itunesSearch(`${song} ${artist}`.trim()), song, artist);
  if (!cands.length) { log(`FAIL no metadata found for "${song}" / "${artist || "?"}"`); return { ok: false }; }

  let chosen;
  if (PICK && cands.length > 1) {
    const pickVal = PICK;
    PICK = undefined; // applies only to the song it was requested for
    const idx = pickVal.split(",").map((x) => parseInt(x.trim()) - 1).filter((i) => i >= 0 && i < cands.length);
    chosen = idx.map((i) => cands[i]);
    if (!chosen.length) { log("FAIL --pick did not match any candidate"); return { ok: false }; }
  } else if (cands.length > 1 && ASK) {
    console.log("SOUNDTECH_ASK " + JSON.stringify({
      song, artist,
      candidates: cands.map((c, i) => ({ n: i + 1, title: c.title, artist: c.artist, album: c.album, duration_s: Math.round(c.duration_s) })),
      instructions: "Ask the user which version(s) to download. Confirm this candidate list still matches what you showed them (query results can shift), then re-run with --pick <numbers> (e.g. --pick 1,3) and the same --search/--out arguments. --pick resolves only the next ambiguous song.",
    }, null, 2));
    process.exit(2);
  } else if (cands.length > 1 && process.stdout.isTTY && !has("--auto")) {
    console.log("Multiple versions found:");
    cands.forEach((c, i) => console.log(`  ${i + 1}. ${c.title} — ${c.artist} — album: ${c.album} — ${Math.round(c.duration_s)}s`));
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ans = await new Promise((res) => rl.question("Pick number(s), comma separated, or 'all': ", res));
    rl.close();
    chosen = ans.trim().toLowerCase() === "all" ? cands
      : ans.split(",").map((x) => cands[parseInt(x.trim()) - 1]).filter(Boolean);
    if (!chosen.length) chosen = [cands[0]];
  } else {
    chosen = [cands[0]];
  }

  let allOk = true;
  for (const c of chosen) {
    const outBase = path.join(OUT, sanitize(`${c.artist.split(",")[0].trim()} - ${c.title}`));
    if (existsSync(`${outBase}.mp3`)) { log(`SKIP exists: ${c.artist} - ${c.title} [${c.album}]`); continue; }

    const primaryArtist = c.artist.split(/,|&|feat\.?/i)[0].trim();
    let best = pickCandidate(ytSearch(`${primaryArtist} ${c.title}`), c.duration_s, c.title);
    if (!best) best = pickCandidate(ytSearch(`${primaryArtist} ${c.title} ${c.album || ""}`), c.duration_s, c.title);
    if (!best) best = pickCandidate(ytSearch(c.title), c.duration_s, c.title);
    if (!best) { log(`FAIL no YouTube match: ${c.artist} - ${c.title}`); allOk = false; continue; }

    // age-gated? probe clean alternates
    if (probeAge(best.id) > 0) {
      log(`  age-restricted (${best.id}), probing alternates...`);
      const alts = ytSearch(`${primaryArtist} ${c.title}`, 10).filter((x) => x.id !== best.id);
      const expectedLive = /\blive\b/i.test(c.title);
      let okAlt = null;
      for (const a of alts.slice(0, 10)) {
        if (!expectedLive && (LIVE_RE.test(a.title) || LIVE_RE.test(a.channel))) continue;
        const tol = Math.max(20, 0.12 * c.duration_s);
        const p = pickCandidate([a], c.duration_s, c.title);
        if (!p || p.diff > tol) continue;
        if (probeAge(p.id) !== 0) { sleep(500); continue; }
        okAlt = p; break;
      }
      if (!okAlt) { log(`FAIL age-restricted, no clean alternate: ${c.artist} - ${c.title}`); allOk = false; continue; }
      best = okAlt;
    }

    try {
      downloadYouTube(best.id, outBase);
      if (!validMp3(`${outBase}.mp3`)) throw new Error("invalid mp3 produced");
      const art = await fetchArtwork(c.artwork, `${outBase}.cover.jpg`);
      tag(`${outBase}.mp3`, { title: c.title, artist: c.artist, album: c.album }, art);
      if (art) unlinkSync(art);
      log(`OK ${c.artist} - ${c.title} [${c.album}] | yt:${best.id} cov ${(best.cov * 100).toFixed(0)}% diff ${best.diff.toFixed(0)}s`);
    } catch (e) {
      const msg = String(e.message || e).slice(0, 160);
      log(`FAIL download: ${c.title} | ${msg}`);
      allOk = false;
      if (/403|timed? ?out/i.test(msg)) { log("--- throttled, backing off 60s ---"); sleep(60000); }
    }
    sleep(900);
  }
  return { ok: allOk };
}

// ---------- url mode ----------
async function processItem(entry) {
  const url = entry.url || entry.webpage_url || entry.original_url || (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : null);
  if (!url) { log("SKIP item without id/url"); return true; }
  let info;
  try {
    info = JSON.parse(run("yt-dlp", ["-J", "--no-warnings", "--skip-download", url], { timeout: 120000 }));
  } catch (e) {
    log(`FAIL extract item: ${entry.title || url} | ${String(e.message || e).slice(0, 150)}`);
    return false;
  }
  const meta = {
    title: (info.track || info.title || "Unknown Title").trim(),
    artist: (info.artist || info.album_artist || info.creator || info.uploader || info.channel || "Unknown Artist").replace(/\s*-\s*Topic\s*$/, "").trim(),
    album: info.album || null,
    artwork: null,
  };
  // Canonicalize via iTunes: YouTube titles/channels are often dirty ("Pixies.- ... (Live 1989)", "Subbacultcha").
  // If the uploader didn't provide structured track metadata, replace with the canonical recording.
  try {
    const hits = metaMatches(await itunesSearch(`${meta.artist.split(",")[0]} ${meta.title}`.trim()), meta.title, meta.artist);
    if (hits[0]) {
      const cov = coverage(meta.title, hits[0].title);
      if (!info.track || cov >= 0.6) {
        meta.title = hits[0].title;
        meta.artist = hits[0].artist;
      }
      meta.album = meta.album || hits[0].album;
      meta.artwork = hits[0].artwork;
    }
  } catch {}
  // "Artist - Title" style YouTube titles: if uploader is generic, split it.
  if (/^(Unknown Artist|VEVO|.*Official)$/.test(meta.artist) && /\s+-\s+/.test(meta.title)) {
    const [a, ...rest] = meta.title.split(/\s+-\s+/);
    if (rest.length) { meta.artist = a.trim(); meta.title = rest.join(" - ").trim(); }
  }
  const outBase = path.join(OUT, sanitize(`${meta.artist.split(",")[0].trim()} - ${meta.title}`));
  if (existsSync(`${outBase}.mp3`)) { log(`SKIP exists: ${meta.artist} - ${meta.title}`); return; }

  const base = ["-x", "--audio-format", "mp3", "--audio-quality", "320K", "--no-playlist", "--no-warnings", "--quiet",
    "-o", `${outBase}.%(ext)s`, url];
  const downloadAndValidate = (dlUrl, clientId) => {
    const args = clientId ? ["--extractor-args", `youtube:player_client=${clientId}`, ...base.slice(0, -1), dlUrl] : [...base.slice(0, -1), dlUrl];
    try { run("yt-dlp", args); } catch { /* fallthrough to validation */ }
    return validMp3(`${outBase}.mp3`);
  };

  try {
    let ok = downloadAndValidate(url, "android") || downloadAndValidate(url, null);
    // stream-blocked / corrupt output? look for an alternate upload of the same song
    if (!ok) {
      log(`  direct download invalid (blocked or stub), probing alternate uploads...`);
      try { unlinkSync(`${outBase}.mp3`); } catch {}
      const alts = ytSearch(`${meta.artist.split(",")[0]} ${meta.title}`.trim(), 10);
      const expectedLive = /\blive\b/i.test(meta.title);
      for (const a of alts.slice(0, 8)) {
        if (!expectedLive && (LIVE_RE.test(a.title) || LIVE_RE.test(a.channel))) continue; // no live versions
        const tol = Math.max(20, 0.12 * (info.duration || 0));
        const p = pickCandidate([a], info.duration || 0, meta.title);
        if (!p || (info.duration && p.diff > tol)) continue;
        if (probeAge(p.id) !== 0) { sleep(500); continue; }
        ok = downloadAndValidate(`https://www.youtube.com/watch?v=${p.id}`, "android") || downloadAndValidate(`https://www.youtube.com/watch?v=${p.id}`, null);
        if (ok) { log(`  used alternate upload ${p.id}: ${p.title.slice(0, 60)}`); break; }
        try { unlinkSync(`${outBase}.mp3`); } catch {}
        sleep(500);
      }
    }
    if (!ok) throw new Error("all download attempts produced invalid mp3");
  } catch (e) {
    log(`FAIL download: ${meta.title} | ${String(e.message || e).slice(0, 150)}`);
    try { unlinkSync(`${outBase}.mp3`); } catch {}
    sleep(60000); // likely throttle or block; cool off
    return false;
  }

  // fill remaining artwork/album if the canonical lookup didn't run or match
  if (!meta.album || !meta.artwork) {
    try {
      const hits = metaMatches(await itunesSearch(`${meta.artist.split(",")[0]} ${meta.title}`.trim()), meta.title, meta.artist);
      if (hits[0]) {
        meta.album = meta.album || hits[0].album;
        meta.artwork = meta.artwork || hits[0].artwork;
      }
    } catch {}
  }

  const art = await fetchArtwork(meta.artwork, `${outBase}.cover.jpg`);
  try {
    tag(`${outBase}.mp3`, meta, art);
  } catch (e) {
    log(`FAIL tag: ${meta.title} | ${String(e.message || e).slice(0, 150)}`);
    if (art) { try { unlinkSync(art); } catch {} }
    try { unlinkSync(`${outBase}.tag.mp3`); } catch {}
    return false;
  }
  if (art) unlinkSync(art);
  log(`OK ${meta.artist} - ${meta.title}${meta.album ? ` [${meta.album}]` : ""}`);
  return true;
}

async function urlMode(urls) {
  let i = 0, failed = 0;
  for (const url of urls) {
    i++;
    log(`=== URL ${i}/${urls.length}: ${url} ===`);
    let info = null;
    try {
      info = JSON.parse(run("yt-dlp", ["-J", "--flat-playlist", "--no-warnings", url], { timeout: 120000 }));
    } catch (e) {
      log(`FAIL extract: ${url} | ${String(e.message || e).slice(0, 150)}`);
      failed++;
      continue;
    }
    const entries = (info.entries && info.entries.length ? info.entries : [info]).filter(Boolean);
    log(`${entries.length} item(s)`);
    for (const e of entries) {
      if (!e) continue;
      try { if (!await processItem(e)) failed++; } catch (err) { log(`FAIL item: ${e.title || e.id} | ${String(err.message || err).slice(0, 150)}`); failed++; }
      sleep(900);
    }
  }
  log(`=== URL MODE DONE (${failed} failed) ===`);
  return failed;
}

// ---------- list mode ----------
function splitLine(line) {
  for (const sep of [" — ", " - ", " – "]) {
    const i = line.indexOf(sep);
    if (i > 0) return [line.slice(0, i).trim(), line.slice(i + sep.length).trim()];
  }
  const u = line.lastIndexOf("_");
  if (u > 0) return [line.slice(0, u).trim().replace(/_/g, " "), line.slice(u + 1).trim().replace(/_/g, " ")];
  return [line.trim(), ""];
}

async function listMode(file) {
  if (!file || !existsSync(file)) {
    console.error(`--list: file not found: ${file}`);
    process.exit(1);
  }
  const lines = readFileSync(file, "utf8").split("\n").map((l) => l.replace(/^\uFEFF/, "").trim()).filter((l) => l && !l.startsWith("#"));
  log(`=== LIST: ${lines.length} items from ${file} ===`);
  let failed = 0;
  for (const line of lines) {
    const [song, artist] = splitLine(line);
    log(`=== item: "${song}" | "${artist || "?"}" ===`);
    const r = await searchAndDownload(song, artist);
    if (!r.ok) { log(`(see failures above for "${song}")`); failed++; }
  }
  log(`=== LIST DONE (${failed} failed) ===`);
  return failed;
}

// ---------- main ----------
const isSearch = has("--search") || (positional.length > 0 && !urls.length && !listFile);

if (urls.length) {
  const failed = await urlMode(urls);
  if (failed > 0) process.exit(1);
} else if (listFile) {
  const failed = await listMode(listFile);
  if (failed > 0) process.exit(1);
} else if (isSearch) {
  let song, artist;
  if (has("--search")) {
    const sv = flagVal("--search");
    if (positional.length >= 2) { song = positional[0]; artist = positional.slice(1).join(" "); }
    else if (positional.length === 1) { [song, artist] = splitLine(positional[0]); }
    else if (sv && (sv.includes("_") || sv.includes(" - "))) { [song, artist] = splitLine(sv); }
    else { song = sv; artist = ""; }
  } else {
    if (positional.length >= 2) { song = positional[0]; artist = positional.slice(1).join(" "); }
    else [song, artist] = splitLine(positional[0] || "");
  }
  if (!song) {
    console.error("Usage: node soundtech.mjs <url> [--out DIR]\n       node soundtech.mjs --search \"Song\" \"Artist\" [--ask|--pick 1,3] [--out DIR]\n       node soundtech.mjs --list songs.txt [--out DIR]");
    process.exit(1);
  }
  const r = await searchAndDownload(song, artist);
  log(`=== SEARCH DONE (${r.ok ? "ok" : "with failures"}) ===`);
  if (!r.ok) process.exit(1);
} else {
  console.error("Usage: node soundtech.mjs <url> [--out DIR]\n       node soundtech.mjs --search \"Song\" \"Artist\" [--ask|--pick 1,3] [--out DIR]\n       node soundtech.mjs --list songs.txt [--out DIR]");
  process.exit(1);
}
