// Guards the /galleries/ photo registry — the gallery counterpart of
// validate-photo-attribution.mjs.
//
// Every image a gallery page shows must (1) be listed in galleries/credits.json with an
// author, licence and source, (2) exist on disk as a real JPEG in both renditions, (3)
// carry the creator / copyright / licensor block in its embedded XMP so the credit
// travels with the file when it is scraped or re-hosted, and (4) carry no location
// data. This site sells photography and licenses the archive, so a frame with no stated
// origin or with a GPS fix baked in is a liability, not an asset.
//
// The pages, the index, the homepage block and the sitemap are generated; if they drift
// from the registry this check fails. Rebuild with:
//   python _deploy/galleries/build-galleries.py

import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const REQUIRED = ["file", "gallery", "width", "height", "author", "license", "license_url", "kind", "source"];

const registry = JSON.parse(await readFile(join(root, "galleries/credits.json"), "utf8"));
const byFile = new Map();
for (const c of registry) {
  for (const f of REQUIRED) if (c[f] === undefined || c[f] === "") errors.push(`${c.file ?? "(entry)"} is missing "${f}"`);
  if (c.kind !== "own") errors.push(`${c.file}: kind "${c.kind}" — galleries carry only our own work`);
  if (byFile.has(c.file)) errors.push(`${c.file} is listed twice`);
  byFile.set(c.file, c);
}

const jpeg = async (rel, minBytes) => {
  let buf;
  try { buf = await readFile(join(root, rel.replace(/^\//, ""))); } catch { errors.push(`${rel}: in use but missing on disk`); return null; }
  if (buf.length < minBytes) errors.push(`${rel}: only ${buf.length} bytes`);
  if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) errors.push(`${rel}: not a JPEG`);
  return buf;
};

const used = new Set();
const dir = join(root, "galleries");
for (const page of (await readdir(dir)).filter((f) => f.endsWith(".html") && f !== "index.html")) {
  const html = await readFile(join(dir, page), "utf8");
  const imgs = [...html.matchAll(/<img src="(img\/[^"]+-sm\.jpg)" data-full="(img\/[^"]+\.jpg)" alt="([^"]*)"/g)];
  if (!imgs.length) errors.push(`galleries/${page}: shows no photographs`);
  for (const [, sm, full, alt] of imgs) {
    const key = `/galleries/${full}`;
    used.add(key);
    if (!byFile.has(key)) errors.push(`galleries/${page}: ${key} is not in galleries/credits.json`);
    if (alt.replace(/ \(photo \d+ of \d+\)$/, "").trim().length < 12) errors.push(`galleries/${page}: ${full} has no real alt text`);
    if (/\d{4}-\d{2}-\d{2}|IMG_\d+/.test(alt)) errors.push(`galleries/${page}: ${full} alt text looks like a filename or date`);
    if (!html.includes(`"contentUrl": "https://tapephoto.com${key}"`)) errors.push(`galleries/${page}: ${key} is missing from the page JSON-LD`);
    const m = html.match(new RegExp(`"numberOfItems": (\\d+)`));
    if (m && Number(m[1]) !== imgs.length) errors.push(`galleries/${page}: numberOfItems ${m[1]} but ${imgs.length} photos shown`);
    void sm;
  }
}

for (const [file, c] of byFile) {
  const full = await jpeg(file, 8_000);
  const sm = await jpeg(file.replace(/\.jpg$/, "-sm.jpg"), 2_500);
  if (!used.has(file)) errors.push(`${file}: in credits.json but no gallery page shows it`);
  for (const [buf, rel] of [[full, file], [sm, file.replace(/\.jpg$/, "-sm.jpg")]]) {
    if (!buf) continue;
    const head = buf.subarray(0, Math.min(buf.length, 65536)).toString("latin1");
    if (!head.includes("https://tapephoto.com/licensing.html")) errors.push(`${rel}: no embedded licensor / web-statement metadata`);
    if (!/Carlos Martinez/.test(head)) errors.push(`${rel}: no embedded creator metadata`);
    if (/GPSLatitude|GPSLongitude/.test(head)) errors.push(`${rel}: embeds a GPS location`);
  }
  if (full) {
    // SOF0/SOF2 marker carries the real pixel size
    let i = 2, w = 0, h = 0;
    while (i < full.length - 9) {
      if (full[i] !== 0xff) { i++; continue; }
      const mk = full[i + 1];
      if (mk === 0xc0 || mk === 0xc2) { h = full.readUInt16BE(i + 5); w = full.readUInt16BE(i + 7); break; }
      i += 2 + full.readUInt16BE(i + 2);
    }
    if (w !== c.width || h !== c.height) errors.push(`${file}: credits.json says ${c.width}x${c.height}, file is ${w}x${h}`);
    if (Math.max(w, h) > 1600) errors.push(`${file}: ${w}x${h} exceeds the 1600px web master`);
  }
}

// the generated sitemap must list every gallery page
const sitemap = await readFile(join(root, "sitemap.xml"), "utf8");
for (const page of (await readdir(dir)).filter((f) => f.endsWith(".html") && f !== "index.html")) {
  if (!sitemap.includes(`https://tapephoto.com/galleries/${page}`)) errors.push(`sitemap.xml does not list galleries/${page}`);
}

if (errors.length) {
  console.error(`Gallery credits check failed (${errors.length} issue(s)):`);
  for (const e of errors.slice(0, 40)) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`Gallery credits check passed (${registry.length} photographs, ${used.size} shown).`);
