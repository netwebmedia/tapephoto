#!/usr/bin/env node
// _deploy/blog-publish.js
// Drains _deploy/posts-queue/*.json into real pages on tapephoto.com:
//   blog/<slug>.html          the article (matches the site chrome)
//   blog/index.html           the journal index, fully re-rendered every run
//   sitemap.xml               a <url> entry per post (+ the /blog/ index)
// then archives the queue item under _published/.
//
// Usage:
//   node _deploy/blog-publish.js              # publish 1
//   node _deploy/blog-publish.js --limit 2
//   node _deploy/blog-publish.js --dry-run
//
// No API calls here — the writing already happened in blog-queue.js. This step
// is deterministic, so a failed publish can always be re-run.

const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const QUEUE_DIR = path.join('_deploy', 'posts-queue');
const PUBLISHED_DIR = path.join(QUEUE_DIR, '_published');
const INDEX_JSON = path.join('_deploy', 'blog-index.json');
const BLOG_DIR = 'blog';
const SITEMAP = 'sitemap.xml';
const ORIGIN = 'https://tapephoto.com';

const args = process.argv.slice(2);
const argVal = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };
const LIMIT = parseInt(argVal('--limit') || '1', 10);
const DRY = args.includes('--dry-run');

// ─── Escaping ────────────────────────────────────────────────────────────────
// All model-written text passes through here before touching HTML.
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// For JSON-LD: collapse whitespace so nothing breaks the block.
const jsonText = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function dateLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} de ${MONTHS[m - 1]} de ${y}`;
}

// ─── Shared chrome ───────────────────────────────────────────────────────────
// Header/footer mirror services.html exactly (with ../ paths) so a blog page
// is indistinguishable from the rest of the site. If the site chrome changes,
// change it here too.

const HEADER = `    <header class="header">
        <a href="../index.html" class="logo">tapephoto</a>
        <button class="menu-toggle" aria-label="Toggle menu" aria-expanded="false" aria-controls="site-nav">
            <span></span><span></span>
        </button>
        <nav class="nav" id="site-nav">
            <a href="../index.html#work">Work</a>
            <a href="../services.html">Services</a>
            <a href="./">Blog</a>
            <a href="../about.html">About</a>
            <a href="../contact.html">Contact</a>
            <a href="../servicios.html" class="nav-es" lang="es" hreflang="es">Espa&ntilde;ol</a>
        </nav>
    </header>`;

const FOOTER = `    <footer class="footer">
        <div class="footer-inner">
            <div class="footer-brand">
                <a href="../index.html" class="logo">tapephoto</a>
                <p>Carlos Martinez Photography<br>Coquimbo, Chile</p>
                <div class="footer-contact">
                    <a href="mailto:carlos@netwebmedia.com">carlos@netwebmedia.com</a>
                    <a href="https://wa.me/14423854585" target="_blank" rel="noopener">WhatsApp +1 (442) 385-4585</a>
                </div>
            </div>
            <div class="footer-links">
                <h4>Navigate</h4>
                <a href="../index.html#work">Work</a>
                <a href="../services.html">Services</a>
                <a href="./">Blog</a>
                <a href="../about.html">About</a>
                <a href="../contact.html">Contact</a>
            </div>
            <div class="footer-social">
                <h4>Follow</h4>
                <a href="https://instagram.com/tapephotocom" target="_blank" rel="noopener">Instagram</a>
                <a href="https://facebook.com/tapephoto" target="_blank" rel="noopener">Facebook</a>
            </div>
        </div>
        <div class="footer-bottom">
            <p>&copy; 2026 TapePhoto. All rights reserved.</p>
        </div>
    </footer>`;

// ─── Article template ────────────────────────────────────────────────────────

function renderPost(post) {
  const label = dateLabel(post.published);

  const body = post.sections.map((s) => {
    if (s.type === 'h2') return `            <h2>${esc(s.text)}</h2>`;
    if (s.type === 'h3') return `            <h3>${esc(s.text)}</h3>`;
    if (s.type === 'ul') {
      const items = s.items.map((it) => `                <li>${esc(it)}</li>`).join('\n');
      return `            <ul>\n${items}\n            </ul>`;
    }
    return `            <p>${esc(s.text)}</p>`;
  }).join('\n\n');

  const faqHtml = post.faq.map((f) => `            <details class="faq-item">
                <summary>${esc(f.q)}</summary>
                <p>${esc(f.a)}</p>
            </details>`).join('\n');

  const articleLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: jsonText(post.title),
    description: jsonText(post.description),
    datePublished: post.published,
    dateModified: post.published,
    inLanguage: 'es',
    mainEntityOfPage: `${ORIGIN}/blog/${post.slug}.html`,
    author: {
      '@type': 'Person',
      '@id': `${ORIGIN}/#carlos`,
      name: 'Carlos Martinez',
      url: `${ORIGIN}/`,
    },
    publisher: { '@type': 'Organization', name: 'TapePhoto', url: `${ORIGIN}/` },
  };

  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: post.faq.map((f) => ({
      '@type': 'Question',
      name: jsonText(f.q),
      acceptedAnswer: { '@type': 'Answer', text: jsonText(f.a) },
    })),
  };

  return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(post.title)} | Blog TapePhoto</title>
    <meta name="description" content="${esc(post.description)}">
    <link rel="canonical" href="${ORIGIN}/blog/${post.slug}.html">
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
    <meta property="og:type" content="article">
    <meta property="og:site_name" content="TapePhoto">
    <meta property="og:title" content="${esc(post.title)}">
    <meta property="og:description" content="${esc(post.description)}">
    <meta property="og:url" content="${ORIGIN}/blog/${post.slug}.html">
    <meta property="og:image" content="${ORIGIN}/images/tape_lifestyle_setup.jpg">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="../style.css">
    <script type="application/ld+json">
${JSON.stringify(articleLd, null, 2)}
    </script>
    <script type="application/ld+json">
${JSON.stringify(faqLd, null, 2)}
    </script>
    <!-- Analytics: the GA4 Measurement ID lives in analytics.js (one place, whole site). -->
    <script src="../analytics.js"></script>
</head>
<body>

${HEADER}

    <main class="blog-page">
        <article class="article">
            <p class="article-tag">${esc(post.tag)}</p>
            <h1>${esc(post.title)}</h1>
            <p class="article-meta">Publicado el ${esc(label)} &middot; ${esc(post.readTime)} de lectura</p>

            <p class="article-lede">${esc(post.lede)}</p>

${body}

            <h2>Preguntas frecuentes</h2>
${faqHtml}

            <div class="article-cta">
                <p class="article-cta-label">&iquest;Necesitas fotograf&iacute;a as&iacute; para tu propiedad o tu negocio?</p>
                <div class="cta-row">
                    <a class="btn-whatsapp" href="https://wa.me/14423854585?text=Hola!%20Le%C3%AD%20el%20art%C3%ADculo%20de%20TapePhoto%20(${encodeURIComponent(post.slug)})" target="_blank" rel="noopener">Escr&iacute;beme por WhatsApp</a>
                    <a class="btn-outline" href="../servicios.html">Ver servicios</a>
                </div>
            </div>

            <p class="article-back"><a href="./">&larr; Volver al blog</a></p>
        </article>
    </main>

${FOOTER}

    <script src="../main.js"></script>
</body>
</html>
`;
}

// ─── Índice del blog — se re-renderiza completo en cada run ──────────────────

function renderIndex(db) {
  const cards = db.items.map((it) => `            <article class="blog-card">
                <p class="article-tag">${esc(it.tag)}</p>
                <h2><a href="${esc(it.slug)}.html">${esc(it.title)}</a></h2>
                <p class="blog-card-meta">${esc(dateLabel(it.published))} &middot; ${esc(it.readTime)} de lectura</p>
                <p class="blog-card-desc">${esc(it.description)}</p>
            </article>`).join('\n\n');

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    '@id': `${ORIGIN}/blog/`,
    name: 'Blog TapePhoto',
    url: `${ORIGIN}/blog/`,
    description: 'Guías de fotografía inmobiliaria, corporativa, de hoteles y drone en La Serena y Coquimbo.',
    author: { '@type': 'Person', '@id': `${ORIGIN}/#carlos`, name: 'Carlos Martinez' },
  };

  return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Blog | Fotograf&iacute;a Inmobiliaria y Comercial en La Serena - TapePhoto</title>
    <meta name="description" content="Gu&iacute;as pr&aacute;cticas de fotograf&iacute;a inmobiliaria, corporativa, de hoteles y drone en La Serena y Coquimbo: c&oacute;mo preparar la sesi&oacute;n y qu&eacute; esperar del proceso.">
    <link rel="canonical" href="${ORIGIN}/blog/">
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="TapePhoto">
    <meta property="og:title" content="Blog TapePhoto — Fotograf&iacute;a Inmobiliaria y Comercial en La Serena">
    <meta property="og:description" content="Gu&iacute;as de fotograf&iacute;a inmobiliaria, corporativa, de hoteles y drone en La Serena y Coquimbo.">
    <meta property="og:url" content="${ORIGIN}/blog/">
    <meta property="og:image" content="${ORIGIN}/images/tape_lifestyle_setup.jpg">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="../style.css">
    <script type="application/ld+json">
${JSON.stringify(ld, null, 2)}
    </script>
    <!-- Analytics: the GA4 Measurement ID lives in analytics.js (one place, whole site). -->
    <script src="../analytics.js"></script>
</head>
<body>

${HEADER}

    <main class="blog-page">
        <section class="blog-intro">
            <h1>el blog.</h1>
            <p class="blog-lead">
                Gu&iacute;as pr&aacute;cticas de fotograf&iacute;a inmobiliaria, corporativa, de hoteles y a&eacute;rea
                con drone en La Serena y Coquimbo: c&oacute;mo preparar la propiedad o el negocio antes
                de la sesi&oacute;n, qu&eacute; esperar del proceso y c&oacute;mo se ven las fotos que s&iacute; venden.
            </p>
        </section>

        <div class="blog-list">
${cards}
        </div>
    </main>

${FOOTER}

    <script src="../main.js"></script>
</body>
</html>
`;
}

function loadIndexDb() {
  if (fs.existsSync(INDEX_JSON)) {
    try { return JSON.parse(fs.readFileSync(INDEX_JSON, 'utf8')); }
    catch { /* fall through to fresh db */ }
  }
  return { updated: null, items: [] };
}

function addToIndex(db, post) {
  db.items = db.items.filter((i) => i.slug !== post.slug);
  db.items.unshift({
    slug: post.slug,
    title: post.title,
    tag: post.tag,
    description: post.description,
    readTime: post.readTime,
    published: post.published,
  });
  db.updated = post.published;
}

// ─── Sitemap ─────────────────────────────────────────────────────────────────

function addToSitemap(loc, lastmod, changefreq, priority) {
  let xml = fs.readFileSync(SITEMAP, 'utf8');
  if (xml.includes(`<loc>${loc}</loc>`)) return;
  const entry = `  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>
`;
  xml = xml.replace('</urlset>', entry + '</urlset>');
  if (!DRY) fs.writeFileSync(SITEMAP, xml, 'utf8');
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(QUEUE_DIR)) {
    console.log('No queue — nothing to publish.');
    return;
  }
  fs.mkdirSync(PUBLISHED_DIR, { recursive: true });
  fs.mkdirSync(BLOG_DIR, { recursive: true });

  const queued = fs.readdirSync(QUEUE_DIR).filter((f) => f.endsWith('.json')).sort();
  if (!queued.length) {
    console.log('Queue empty — nothing to publish. (Run blog-queue.js, or wait for generate-blog-queue.yml.)');
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const db = loadIndexDb();
  let published = 0;

  for (const file of queued.slice(0, LIMIT)) {
    const full = path.join(QUEUE_DIR, file);
    let post;
    try {
      post = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (e) {
      console.error(`✗ ${file}: invalid JSON — left in the queue (${e.message})`);
      continue;
    }
    for (const k of ['title', 'description', 'lede', 'slug', 'tag']) {
      if (!post[k]) { post = null; break; }
    }
    if (!post) {
      console.error(`✗ ${file}: missing required fields — left in the queue`);
      continue;
    }
    post.published = today;
    if (!post.readTime) post.readTime = '7 min';

    const target = path.join(BLOG_DIR, `${post.slug}.html`);
    if (fs.existsSync(target)) {
      console.error(`✗ ${post.slug}: a page with that slug already exists — archiving without overwriting`);
      if (!DRY) fs.renameSync(full, path.join(PUBLISHED_DIR, file));
      continue;
    }

    if (!DRY) fs.writeFileSync(target, renderPost(post), 'utf8');
    addToIndex(db, post);
    addToSitemap(`${ORIGIN}/blog/${post.slug}.html`, post.published, 'monthly', '0.7');
    if (!DRY) fs.renameSync(full, path.join(PUBLISHED_DIR, file));

    console.log(`✓ blog/${post.slug}.html — ${post.title}`);
    published++;
  }

  if (published && !DRY) {
    fs.writeFileSync(INDEX_JSON, JSON.stringify(db, null, 2) + '\n', 'utf8');
    fs.writeFileSync(path.join(BLOG_DIR, 'index.html'), renderIndex(db), 'utf8');
    addToSitemap(`${ORIGIN}/blog/`, today, 'daily', '0.8');
  }

  const left = fs.readdirSync(QUEUE_DIR).filter((f) => f.endsWith('.json')).length;
  console.log(`\n${DRY ? '[dry-run] ' : ''}Published: ${published} · left in queue: ${left}`);
}

main();
