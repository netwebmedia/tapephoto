#!/usr/bin/env node
// _deploy/blog-queue.js
// Escribe artículos en español de fotografía comercial e inmobiliaria para tapephoto.com en
// _deploy/posts-queue/*.json using the Claude API. Drained by
// _deploy/blog-publish.js (1/day cadence — see publish-blogs.yml).
//
// Usage:
//   node _deploy/blog-queue.js                # add up to COUNT_DEFAULT posts
//   node _deploy/blog-queue.js --count 4
//
// Requires: ANTHROPIC_API_KEY
//
// Topic space is combinatorial but deliberately small: 10 subjects x 5 angles
// = 50 unique articles, ~7 weeks at 1/day. When it runs dry the script says so
// loudly instead of repeating itself — extend SUBJECTS/ANGLES then, not before.

const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const QUEUE_DIR = path.join('_deploy', 'posts-queue');
const PUBLISHED_DIR = path.join(QUEUE_DIR, '_published');
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';
const COUNT_DEFAULT = 10;          // weekly refill vs ~7/week drain = small buffer
const MIN_WORDS = 750;             // hard floor; the prompt aims for ~1100
const MAX_ATTEMPTS = 3;            // retries per topic on invalid/short output
const REQUEST_TIMEOUT_MS = 180000;

// ─── CLI ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const argVal = (flag) => { const i = args.indexOf(flag); return i === -1 ? null : args[i + 1]; };
const COUNT = parseInt(argVal('--count') || COUNT_DEFAULT, 10);

// ─── Topic space — the exact matrix from the portfolio rollout brief ─────────

/* El espacio temático sigue lo que TapePhoto realmente vende (Carlos, 2026-07-10):
   fotografía comercial e inmobiliaria en La Serena y Coquimbo — no fotografía
   analógica. Cada sujeto mapea a una página de servicio real del sitio, así que
   cada artículo tiene un destino comercial natural en vez de un CTA genérico. */
const SUBJECTS = [
  { key: 'fotografia-inmobiliaria', prompt: 'fotografía inmobiliaria para vender o arrendar propiedades',        tag: 'Inmobiliaria' },
  { key: 'fotos-para-portales',     prompt: 'preparar las fotos de una propiedad para los portales inmobiliarios', tag: 'Inmobiliaria' },
  { key: 'drone-inmobiliario',      prompt: 'fotografía aérea con drone aplicada a propiedades y terrenos',      tag: 'Drone' },
  { key: 'fotografia-empresas',     prompt: 'fotografía corporativa y de equipo para empresas',                  tag: 'Empresas' },
  { key: 'fotos-de-producto',       prompt: 'fotografía de producto para negocios locales',                      tag: 'Empresas' },
  { key: 'retrato-corporativo',     prompt: 'retratos corporativos y fotos de perfil profesional',               tag: 'Empresas' },
  { key: 'fotografia-hoteles',      prompt: 'fotografía para hoteles, cabañas y alojamientos turísticos',        tag: 'Turismo' },
  { key: 'fotografia-restaurantes', prompt: 'fotografía para restaurantes y locales gastronómicos',              tag: 'Turismo' },
  { key: 'fotografia-eventos',      prompt: 'cobertura fotográfica de eventos corporativos',                     tag: 'Eventos' },
  { key: 'preparar-la-sesion',      prompt: 'cómo preparar un espacio o negocio antes de la sesión de fotos',    tag: 'Técnica' },
];

const ANGLES = [
  { key: 'guia',        prompt: 'una guía completa para quien nunca ha contratado este servicio' },
  { key: 'checklist',   prompt: 'un checklist de preparación — qué dejar listo antes de que llegue el fotógrafo' },
  { key: 'errores',     prompt: 'los errores más comunes y cómo evitarlos' },
  { key: 'que-esperar', prompt: 'qué esperar del proceso: cómo se agenda, cuánto dura y qué se entrega' },
  { key: 'vale-la-pena', prompt: 'cuándo vale la pena invertir en fotografía profesional y cuándo no hace falta' },
];

/* Interleaved: each lap covers all 10 subjects, each paired with a different
   angle offset, so consecutive posts never share subject OR angle, and over
   5 laps every (subject, angle) pair appears exactly once. Deterministic,
   therefore auditable. */
function* topicCombinations() {
  for (let lap = 0; lap < ANGLES.length; lap++) {
    for (let s = 0; s < SUBJECTS.length; s++) {
      const subject = SUBJECTS[s];
      const angle = ANGLES[(s + lap) % ANGLES.length];
      yield {
        prompt: `${subject.prompt} — ${angle.prompt}`,
        slug: `${subject.key}-${angle.key}`,
        tag: subject.tag,
      };
    }
  }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function existingSlugs() {
  const out = new Set();
  for (const dir of [QUEUE_DIR, PUBLISHED_DIR]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        out.add(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).slug);
      } catch { /* corrupt file: ignore */ }
    }
  }
  // Never collide with a page that already exists on the site.
  if (fs.existsSync('blog')) {
    for (const f of fs.readdirSync('blog')) {
      if (f.endsWith('.html')) out.add(f.replace(/\.html$/, ''));
    }
  }
  out.add('index');
  return out;
}

// Normalized headline key: the duplicate that matters is the one the reader
// and the search engine see as the same, not the byte-identical one.
function titleKey(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(?:the|a|an) /, '');
}

function existingTitles() {
  const out = new Set();
  for (const dir of [QUEUE_DIR, PUBLISHED_DIR]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (p.title) out.add(titleKey(p.title));
      } catch { /* corrupt file: ignore */ }
    }
  }
  return out;
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Escribes para el blog de TapePhoto (tapephoto.com/blog/), el estudio de fotografía
comercial de Carlos Martínez en La Serena y Coquimbo, Chile. TapePhoto vende fotografía
inmobiliaria, corporativa, de hoteles y turismo, y cobertura aérea con drone. El lector
típico es un corredor de propiedades, dueño de un negocio local o administrador de un
hotel o cabaña que está evaluando contratar fotografía profesional.

VOZ
- Español de Chile, claro y directo. Registro profesional pero cercano, sin tecnicismos
  innecesarios. Trata al lector como un adulto que sabe de su negocio pero no de fotografía.
- Frases cortas. Detalle concreto donde exista.
- Nada de "¡Descubre el maravilloso mundo de la fotografía!". Sin entusiasmo de signos
  de exclamación. Sin relleno.

REGLAS EDITORIALES — OBLIGATORIAS, NO NEGOCIABLES
1. NUNCA inventes precios, tarifas ni valores de sesión. TapePhoto cotiza caso a caso.
   Si el tema exige hablar de costo, escribe alrededor de él (qué hace variar el precio:
   metros cuadrados, cantidad de ambientes, si incluye drone) y remite a cotizar.
2. NUNCA inventes estadísticas, estudios, porcentajes ni citas. Si no puedes respaldar un
   número, escribe la idea sin el número o di explícitamente que varía.
3. NUNCA inventes datos del mercado inmobiliario chileno, plazos de venta ni cifras de
   portales. Escribe sobre proceso y criterio, no sobre cifras.
4. Nada de nombres de clientes, marcas ni propiedades específicas. Habla en general.
5. El objetivo es ser útil primero. Un artículo que enseña a preparar bien una propiedad
   vale más que uno que solo vende la sesión.

JSON — the format matters as much as the text
- Devuelve SOLO un objeto JSON válido. Sin texto antes ni después, sin bloques de código.
- Sin comillas tipográficas ni comillas dobles dentro de los valores. Para enfatizar un
  término usa guiones — así. Una comilla sin escapar destruye el artículo completo.
- Sin saltos de línea literales dentro de un string. Un párrafo = un string.

FORMATO — devuelve exactamente esta forma:
{
  "title": "titular claro, máximo 70 caracteres, sin clickbait",
  "tag": "uno de: Inmobiliaria, Drone, Empresas, Turismo, Eventos, Técnica",
  "description": "meta description, 140-160 caracteres, sin comillas",
  "lede": "párrafo de apertura, 2-3 frases, nombra el problema real",
  "readTime": "7 min",
  "faq": [
    { "q": "una pregunta que la gente realmente busca", "a": "respuesta de 2-4 frases" }
  ],
  "sections": [
    { "type": "h2", "text": "subtítulo" },
    { "type": "p",  "text": "párrafo" },
    { "type": "ul", "items": [ "item", "item" ] }
  ]
}

El orden importa: "faq" va ANTES de "sections" porque sections es largo. Escribe primero
las 3 entradas de FAQ y luego desarrolla el cuerpo.

ESTRUCTURA — la extensión es un requisito, no una sugerencia
- 6 a 8 bloques h2, cada uno seguido de 2-3 párrafos completos. Al menos una lista ul.
- MÍNIMO 900 palabras, objetivo 1100. Un artículo de 500 palabras no responde nada en
  profundidad. Desarrolla cada sección.
- Párrafos de 3-5 frases. Explica el porqué, no solo el qué. Anticipa la objeción del
  lector.
- Exactamente 3 entradas de FAQ, redactadas como búsquedas reales.
- Cuando el tema sea inmobiliario, es natural mencionar que las fotos se publican en
  portales; menciona Marpolis (marpolis.com) solo si encaja de forma genuina, nunca forzado.
- El texto debe servir tanto a quien nunca ha contratado fotografía como a un corredor
  que publica propiedades cada semana.`;

// ─── API call ────────────────────────────────────────────────────────────────

async function generateOne(combo, apiKey) {
  const userPrompt = `Escribe un artículo para el blog de TapePhoto sobre: ${combo.prompt}`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 12000,
        messages: [{ role: 'user', content: userPrompt }],
        system: SYSTEM_PROMPT,
      }),
      signal: ac.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`API timeout after ${REQUEST_TIMEOUT_MS / 1000}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text();
    // Out of credits / revoked key: no retry can succeed — abort the whole run
    // instead of burning an attempt per topic on calls that cannot work.
    if (res.status === 401 || res.status === 403 || /credit balance/i.test(body)) {
      const e = new Error(`API blocked (${res.status}): ${body.slice(0, 300)}`);
      e.isBlock = true;
      throw e;
    }
    throw new Error(`API error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  return extractPost(data.content[0].text);
}

// The model does not always return bare JSON — it sometimes wraps it in a code
// fence or adds a sentence around it. Cut the first balanced JSON value out
// rather than losing the (already paid-for) article.
function extractPost(raw) {
  const text = String(raw).trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '');

  const start = text.indexOf('{');
  if (start === -1) throw new Error('response contains no JSON');

  let depth = 0, inStr = false, escaped = false, end = -1;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { end = i + 1; break; }
  }
  if (end === -1) throw new Error('incomplete JSON (truncated response?)');

  return JSON.parse(text.slice(start, end));
}

// A malformed block does not justify throwing away the article: drop the block,
// revalidate what remains.
function repair(post) {
  if (!Array.isArray(post.sections)) return;
  post.sections = post.sections.filter((s) => {
    if (!s || !s.type) return false;
    if (s.type === 'ul') {
      if (!Array.isArray(s.items)) return false;
      s.items = s.items.filter((it) => typeof it === 'string' && it.trim());
      return s.items.length > 0;
    }
    return typeof s.text === 'string' && s.text.trim().length > 0;
  });
  if (Array.isArray(post.faq)) {
    post.faq = post.faq.filter((f) => f && f.q && f.a);
  }
}

function validate(post, takenTitles) {
  for (const k of ['title', 'description', 'lede']) {
    if (!post[k] || typeof post[k] !== 'string') return `missing ${k}`;
  }
  if (takenTitles.has(titleKey(post.title))) return `duplicate headline: "${post.title}"`;
  if (!Array.isArray(post.sections) || post.sections.length < 4) return 'too few sections';
  if (!Array.isArray(post.faq) || post.faq.length < 1) return 'empty faq';
  for (const f of post.faq) if (!f.q || !f.a) return 'incomplete faq entry';
  // Length is verified, not trusted to the prompt: a truncated post is useless.
  const words = post.sections.reduce((n, s) => n + (s.type === 'ul'
    ? s.items.reduce((m, it) => m + it.split(/\s+/).length, 0)
    : s.text.split(/\s+/).length), 0);
  if (words < MIN_WORDS) return `only ${words} words (minimum ${MIN_WORDS})`;
  return null;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY is not set');
    process.exit(1);
  }

  fs.mkdirSync(QUEUE_DIR, { recursive: true });
  fs.mkdirSync(PUBLISHED_DIR, { recursive: true });

  const taken = existingSlugs();
  const takenTitles = existingTitles();

  const chosen = [];
  for (const combo of topicCombinations()) {
    if (chosen.length >= COUNT) break;
    if (taken.has(combo.slug)) continue;
    chosen.push(combo);
  }
  if (chosen.length < COUNT) {
    console.log(`::warning::Topic space nearly exhausted — only ${chosen.length} unused combination(s) left. Extend SUBJECTS/ANGLES in _deploy/blog-queue.js.`);
  }

  console.log(`Generating ${chosen.length} post(s)…`);
  let written = 0, abandoned = 0;

  topics:
  for (const combo of chosen) {
    console.log(`  topic: ${combo.prompt}`);
    let accepted = null, lastWhy = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !accepted; attempt++) {
      let post;
      try {
        post = await generateOne(combo, apiKey);
      } catch (e) {
        if (e.isBlock) {
          console.error(`::error::${e.message} — aborting the run; ${written} post(s) already written will still be committed.`);
          break topics;
        }
        lastWhy = e.message;
        console.error(`  · attempt ${attempt}/${MAX_ATTEMPTS}: ${e.message}`);
        if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * 3000));
        continue;
      }

      repair(post);
      const why = validate(post, takenTitles);
      if (why) {
        lastWhy = why;
        console.error(`  · attempt ${attempt}/${MAX_ATTEMPTS}: ${why}`);
        if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * 3000));
      } else {
        accepted = post;
      }
    }

    if (!accepted) {
      console.error(`  ✗ abandoned after ${MAX_ATTEMPTS} attempts (${lastWhy})`);
      abandoned++;
      continue;
    }

    accepted.slug = combo.slug;
    accepted.tag = accepted.tag || combo.tag;
    accepted.topic = combo.prompt;
    accepted.created = new Date().toISOString().slice(0, 10);
    if (!accepted.readTime) accepted.readTime = '7 min';

    taken.add(accepted.slug);
    takenTitles.add(titleKey(accepted.title));

    const file = path.join(QUEUE_DIR, `${accepted.created}-${accepted.slug}.json`);
    fs.writeFileSync(file, JSON.stringify(accepted, null, 2) + '\n', 'utf8');
    console.log(`  ✓ ${accepted.slug}`);
    written++;
  }

  const pending = fs.readdirSync(QUEUE_DIR).filter((f) => f.endsWith('.json')).length;
  console.log(`\nDone: ${written} queued, ${abandoned} abandoned. Pending now: ${pending}`);
  if (written === 0 && chosen.length > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
