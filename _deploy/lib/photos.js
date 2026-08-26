// Cover photographs for the blog, with their credit.
//
// TapePhoto shoots for a living, so every picture on this blog is TapePhoto's
// own work out of images/ — resized into assets/photos/ and recorded in
// assets/photos/credits.json with its alt text in both languages. The caption
// under each hero names the photographer, which is the same rule the rest of
// the portfolio follows for licensed third-party photographs.
//
// This is a trimmed copy of _deploy/lib/blog-photos.js in the netwebmedia
// monorepo, which is where the registry is generated
// (`node _deploy/fetch-blog-photos.js --property tapephoto`, with
// TAPEPHOTO_ROOT pointing at a clone of this repo). Keep the two in step: if
// the caption format changes there, change it here too.

'use strict';

const fs = require('fs');
const path = require('path');

const REGISTRY = path.join(__dirname, '..', '..', 'assets', 'photos', 'credits.json');

let cache = null;
function registry() {
  if (!cache) {
    cache = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
    if (!Array.isArray(cache) || !cache.length) throw new Error('assets/photos/credits.json is empty');
  }
  return cache;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < String(str).length; i += 1) h = (h * 31 + String(str).charCodeAt(i)) & 0x7fffffff;
  return h;
}

// Primero gana, de específico a genérico; el último es el comodín.
const TAG_RULES = [
  [/\b(drone|dron|aérea|aerea|altura)\b/i, 'drone'],
  [/\b(hotel|cabaña|cabana|turismo|turista|alojamiento)\b/i, 'turismo'],
  [/\b(evento|matrimonio|congreso|feria|celebra)\b/i, 'eventos'],
  [/\b(propiedad|inmobiliaria|casa|departamento|corredor|arriendo)\b/i, 'inmobiliaria'],
  [/\b(luz|lente|cámara|camara|técnic|tecnic|edición|edicion|encuadre)\b/i, 'tecnica'],
  [/.*/, 'empresas'],
];

// Determinista por slug: volver a renderizar no puede cambiarle la portada a un
// artículo ya publicado.
function photoFor(post) {
  const text = [post.title, post.description, post.tag, String(post.slug || '').replace(/-/g, ' ')]
    .filter(Boolean).join(' ');
  let tag = 'empresas';
  for (const [re, value] of TAG_RULES) if (re.test(text)) { tag = value; break; }
  const pool = registry().filter((p) => p.tag === tag);
  const from = pool.length ? pool : registry();
  return from[hash(post.slug) % from.length];
}

const smFile = (file) => file.replace(/\.jpg$/, '-sm.jpg');
const ogImage = (photo, origin) => `${origin.replace(/\/$/, '')}${photo.file}`;

function creditHtml(photo) {
  if (photo.kind === 'own' || photo.kind === 'generated') {
    return `${photo.kind === 'own' ? 'Foto' : 'Ilustración'}: ${esc(photo.author)}`;
  }
  const link = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener nofollow">${esc(text)}</a>`;
  const who = photo.author_url ? link(photo.author_url, photo.author) : esc(photo.author);
  return `Foto: ${who} · ${link(photo.license_url, photo.license)} · Fuente: ${link(photo.source, photo.source_name || 'Wikimedia Commons')}`;
}

function figureHtml(photo, indent = '            ') {
  return `${indent}<figure class="article-photo">
${indent}  <img src="${esc(photo.file)}" width="${photo.width}" height="${photo.height}" alt="${esc(photo.alt_es)}" loading="eager" decoding="async">
${indent}  <figcaption>${creditHtml(photo)}</figcaption>
${indent}</figure>`;
}

function thumbHtml(photo) {
  return `<span class="card-thumb"><img src="${esc(smFile(photo.file))}" width="${photo.sm_width || 560}" height="${photo.sm_height || 315}" alt="${esc(photo.alt_es)}" loading="lazy" decoding="async"></span>`;
}

module.exports = { registry, photoFor, figureHtml, thumbHtml, creditHtml, ogImage, smFile, esc };
