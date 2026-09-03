// Guards the photo credits on this blog.
//
// Every picture here is TapePhoto's own work, resized out of images/ into
// assets/photos/ and recorded in assets/photos/credits.json. This check makes it
// impossible to ship a page showing a file the registry does not cover, or a
// hero whose caption has lost the credit — the same guarantee the rest of the
// Don Gastón portfolio has, and the reason it exists there: a picture with no
// stated origin is indistinguishable from one we had no right to publish.
//
// If a third-party photograph is ever added here it must be attribution-only
// (CC BY / CC0 / PD Mark) and carry its author, licence and source, because
// this site sells a service — every page on it is commercial use.
//
// The registry is generated from the netwebmedia monorepo:
//   TAPEPHOTO_ROOT=<this clone> node _deploy/fetch-blog-photos.js --property tapephoto

import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://tapephoto.com";

// COMPARISON KEYS, not the URL we render. Every lookup goes through normalise()
// below, which strips the scheme difference, /deed.<lang> and the trailing slash,
// so these are deliberately written in that stripped form and must stay that way —
// adding the trailing slash here matches nothing and would fail every third-party
// photo the moment one is added. The href that actually ships is credits.json's
// license_url, which must carry the trailing slash: creativecommons.org 301s the
// bare form, and an attribution link is a licence condition, not decoration.
const ALLOWED_LICENCES = new Set([
  "https://creativecommons.org/licenses/by/2.0",
  "https://creativecommons.org/licenses/by/3.0",
  "https://creativecommons.org/licenses/by/4.0",
  "https://creativecommons.org/publicdomain/zero/1.0",
  "https://creativecommons.org/publicdomain/mark/1.0",
]);
const OWN_KINDS = new Set(["own", "generated"]);

const normalise = (url) =>
  String(url || "").trim().replace(/^http:/, "https:").replace(/\/deed\.[a-z_-]+$/i, "").replace(/\/+$/, "");

const ownWorkOk = (photo) => {
  if (!OWN_KINDS.has(photo.kind)) return false;
  try { return new URL(normalise(photo.license_url)).origin === new URL(photo.source).origin; }
  catch { return false; }
};

const errors = [];
let registry = [];
try {
  registry = JSON.parse(await readFile(join(root, "assets/photos/credits.json"), "utf8"));
} catch (e) {
  console.error(`assets/photos/credits.json is unreadable (${e.message})`);
  process.exit(1);
}

const byFile = new Map();
for (const photo of registry) {
  for (const field of ["file", "author", "license", "license_url", "source", "alt_es", "alt_en", "tag"]) {
    if (!photo[field]) errors.push(`${photo.file ?? "(entry)"} is missing "${field}"`);
  }
  if (!ALLOWED_LICENCES.has(normalise(photo.license_url)) && !ownWorkOk(photo)) {
    errors.push(`${photo.file}: ${photo.license_url} is neither attribution-only nor our own work`);
  }
  if (byFile.has(photo.file)) errors.push(`${photo.file} is listed twice`);
  byFile.set(photo.file, photo);

  for (const [rel, floor] of [[photo.file, 6_000], [photo.file.replace(/\.jpg$/, "-sm.jpg"), 2_000]]) {
    try {
      const meta = await stat(join(root, rel.replace(/^\//, "")));
      const bytes = await readFile(join(root, rel.replace(/^\//, "")));
      if (!meta.isFile() || meta.size < floor) errors.push(`${rel}: expected a JPEG of at least ${floor / 1000} KB`);
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) errors.push(`${rel}: not a JPEG`);
    } catch {
      errors.push(`${rel}: in credits.json but missing on disk`);
    }
  }
}

let checked = 0;
for (const file of (await readdir(join(root, "blog"))).filter((f) => f.endsWith(".html") && f !== "index.html")) {
  const page = `blog/${file}`;
  const html = await readFile(join(root, page), "utf8");
  const fig = html.match(/<figure class="article-photo">[\s\S]*?<\/figure>/);
  if (!fig) { errors.push(`${page}: has no hero photograph`); continue; }

  const img = fig[0].match(/<img src="([^"]+)"[^>]*alt="([^"]*)"/);
  if (!img) { errors.push(`${page}: the hero <figure> has no usable <img>`); continue; }
  const photo = byFile.get(img[1]);
  if (!photo) { errors.push(`${page}: hero ${img[1]} is not in credits.json`); continue; }
  if (img[2] !== photo.alt_es) errors.push(`${page}: hero alt text does not match credits.json`);
  if (!/<figcaption>/.test(fig[0])) errors.push(`${page}: the hero has no <figcaption> credit`);

  const needs = OWN_KINDS.has(photo.kind) ? [photo.author] : [photo.author, photo.license_url, photo.source];
  for (const value of needs) if (!fig[0].includes(value)) errors.push(`${page}: the credit is missing "${value}"`);
  if (!html.includes(`content="${ORIGIN}${photo.file}"`)) errors.push(`${page}: og:image is not this article's own picture`);
  checked += 1;
}

try {
  const attribution = await readFile(join(root, "assets/photos/ATTRIBUTION.md"), "utf8");
  for (const photo of registry) {
    if (!attribution.includes(photo.author)) errors.push(`ATTRIBUTION.md does not name ${photo.author}`);
  }
} catch {
  errors.push("assets/photos/ATTRIBUTION.md is missing");
}

if (errors.length) {
  console.error(`Photo attribution check failed (${errors.length} issue(s)):`);
  for (const error of errors.slice(0, 40)) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`Photo attribution check passed (${registry.length} in the registry, ${checked} article heroes).`);
