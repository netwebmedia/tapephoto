#!/usr/bin/env node
// _deploy/blog-queue.js
// Writes English analog-photography articles for tapephoto.com into
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

const SUBJECTS = [
  { key: '35mm-film',          prompt: 'shooting 35mm film',                              tag: 'Film' },
  { key: 'instant-film',       prompt: 'instant film photography (Polaroid and Instax)',  tag: 'Instant' },
  { key: 'tape-aesthetics',    prompt: 'VHS and tape aesthetics in photos and video',     tag: 'Tape' },
  { key: 'film-cameras',       prompt: 'film cameras',                                    tag: 'Cameras' },
  { key: 'home-developing',    prompt: 'developing film at home',                         tag: 'Darkroom' },
  { key: 'scanning-negatives', prompt: 'scanning film negatives',                         tag: 'Darkroom' },
  { key: 'expired-film',       prompt: 'shooting expired film',                           tag: 'Film' },
  { key: 'disposable-cameras', prompt: 'disposable cameras',                              tag: 'Cameras' },
  { key: 'film-vs-digital',    prompt: 'film versus digital photography',                 tag: 'Film' },
  { key: 'black-and-white',    prompt: 'black and white film photography',                tag: 'Film' },
];

const ANGLES = [
  { key: 'beginner-guide', prompt: 'a beginner guide for someone starting from zero' },
  { key: 'gear-checklist', prompt: 'the gear checklist — what you actually need and what can wait' },
  { key: 'mistakes',       prompt: 'the most common mistakes and how to avoid them' },
  { key: 'technique',      prompt: 'a technique deep-dive for someone past the basics' },
  { key: 'buying-guide',   prompt: 'a buying guide for 2026 — what to look for and what to skip' },
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

const SYSTEM_PROMPT = `You write for the TapePhoto journal (tapephoto.com/blog/), the analog-photography
notebook of Carlos Martinez, a photographer based in Coquimbo, Chile who shoots motorsport,
concerts, aerial and street work — and loves film, instant cameras and tape-era aesthetics.

VOICE
- Plain, direct English. Practical magazine register, occasional first person. Treat the
  reader as an adult. Short sentences. Concrete detail where it exists.
- No "Discover the magical world of film!" filler. No exclamation-mark enthusiasm.

EDITORIAL RULES — MANDATORY, NON-NEGOTIABLE
1. NEVER invent specific prices, stock levels or availability for named products. Price talk
   is allowed only as broad, clearly-approximate ranges that are common market knowledge,
   and always flagged as approximate and changing.
2. NEVER invent statistics, studies, percentages or quotes. If you cannot stand behind a
   number, write the idea without the number or say explicitly that it varies.
3. Camera/film model names may be mentioned as well-known examples, but never with invented
   specs. When unsure of a spec, describe the category instead of the model.
4. Chemical safety matters: any developing-at-home content must mention ventilation, gloves
   where relevant, and proper disposal — briefly, not as a lecture.
5. No affiliate-style pushing. TapePhoto sells photography services, not gear.

JSON — the format matters as much as the text
- Return ONLY one valid JSON object. No text before or after, no code fences.
- No typographic quotes and no double quotes inside string values. To emphasise a term,
  use dashes — like this. One unescaped quote destroys the whole article.
- No literal newlines inside a string. One paragraph = one string.

FORMAT — return exactly this shape:
{
  "title": "clear headline, max 70 characters, no clickbait colon-stacking",
  "tag": "one of: Film, Instant, Tape, Cameras, Darkroom, Technique",
  "description": "meta description, 140-160 characters, no quotes",
  "lede": "opening paragraph, 2-3 sentences, name the real problem or itch",
  "readTime": "7 min",
  "faq": [
    { "q": "a question people actually search", "a": "a 2-4 sentence answer" }
  ],
  "sections": [
    { "type": "h2", "text": "subheading" },
    { "type": "p",  "text": "paragraph" },
    { "type": "ul", "items": [ "item", "item" ] }
  ]
}

Order matters: "faq" goes BEFORE "sections" because sections is long. Write the 3 FAQ
entries first, then develop the body.

STRUCTURE — length is a requirement, not a suggestion
- 6 to 8 h2 blocks, each followed by 2-3 full paragraphs. At least one ul list.
- MINIMUM 900 words, target 1100. A 500-word article answers nothing in depth and earns
  no citation. Develop every section.
- Paragraphs of 3-5 sentences. Explain the why, not just the what. Anticipate the
  reader's objection.
- Exactly 3 FAQ entries, phrased as real search queries.
- The text must serve both someone who has never loaded a roll and someone who shoots weekly.`;

// ─── API call ────────────────────────────────────────────────────────────────

async function generateOne(combo, apiKey) {
  const userPrompt = `Write one article for the TapePhoto journal about: ${combo.prompt}`;

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
