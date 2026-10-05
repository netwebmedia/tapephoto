#!/usr/bin/env python3
"""Build every page under /galleries/ from one manifest.

    python _deploy/galleries/build-galleries.py --bootstrap   # one-off: read the live pages into manifest.json
    python _deploy/galleries/build-galleries.py               # render all gallery pages, the index,
                                                              # the homepage block and the sitemap entries

manifest.json is the single source of truth: categories (in display order) and
galleries (in display order within a category), each with its photos. Image files
live in galleries/img/<slug>/<slug>-NN.jpg (1600px long edge) + -sm.jpg (800px);
their provenance is in galleries/credits.json.
"""
import html, json, re, sys
from PIL import Image
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GAL = ROOT / "galleries"
MANIFEST = Path(__file__).with_name("manifest.json")
SITE = "https://tapephoto.com"
CSS_V = "20261005"
TODAY = date.today().isoformat()
PERSON = {"@type": "Person", "@id": f"{SITE}/#carlos", "name": "Carlos Martinez", "url": f"{SITE}/"}
LICENSE_PAGE = f"{SITE}/licensing.html"

esc = lambda s: html.escape(s, quote=True)


# --------------------------------------------------------------------------- bootstrap
def bootstrap():
    idx = (GAL / "index.html").read_text(encoding="utf-8")
    cats = []
    for m in re.finditer(r'<section class="gallery-section" id="([^"]+)">\s*<div class="gallery-section-head">\s*'
                         r'<h2>(.*?)</h2>\s*<p>(.*?) · \d+ photos</p>(.*?)</section>', idx, re.S):
        cid, name, blurb, body = m.groups()
        slugs = re.findall(r'<a class="gallery-card" href="([^"]+)\.html">', body)
        covers = dict(re.findall(r'<a class="gallery-card" href="([^"]+)\.html">\s*<img src="img/[^/]+/[^"]+-(\d+)-sm\.jpg"', body))
        cats.append(dict(id=cid, name=html.unescape(name), short=html.unescape(name).split(" &")[0].split(" & ")[0].lower(),
                         blurb=html.unescape(blurb), galleries=slugs, covers=covers))
    galleries = []
    for c in cats:
        for slug in c["galleries"]:
            page = (GAL / f"{slug}.html").read_text(encoding="utf-8")
            title = html.unescape(re.search(r"<h1>(.*?)</h1>", page).group(1))
            kicker = html.unescape(re.search(r'<p class="gallery-kicker">(.*?)</p>', page).group(1))
            kparts = kicker.split(" · ")
            intro = html.unescape(re.search(r'<p class="gallery-intro">(.*?)</p>', page, re.S).group(1))
            fulls = re.findall(r'"contentUrl": "[^"]+/(' + re.escape(slug) + r'-\d+)\.jpg",\s*"width": (\d+),\s*"height": (\d+)', page)
            full = {k: (int(w), int(h)) for k, w, h in fulls}
            photos = []
            for src, alt, w, h in re.findall(r'<img src="img/[^"]+/([^"/]+)-sm\.jpg" data-full="[^"]+" alt="(.*?)" width="(\d+)" height="(\d+)"', page):
                alt = re.sub(r" \(photo \d+ of \d+\)$", "", html.unescape(alt))
                fw, fh = full.get(src) or Image.open(GAL / "img" / slug / f"{src}.jpg").size
                photos.append(dict(file=src, alt=alt, w=fw, h=fh, sw=int(w), sh=int(h)))
            cover = int(c["covers"].get(slug, "1")) - 1
            card_alt = re.search(r'<a class="gallery-card" href="' + re.escape(slug) + r'\.html">\s*<img [^>]*alt="(.*?)"', idx, re.S)
            galleries.append(dict(slug=slug, title=title, category=c["id"], label=kparts[0],
                                  kicker=" · ".join(kparts[1:-1]), intro=intro, cover=cover,
                                  cover_alt=html.unescape(card_alt.group(1)) if card_alt else photos[cover]["alt"],
                                  updated="2026-10-02", photos=photos))
    for c in cats:
        c.pop("galleries"); c.pop("covers")
    intro = html.unescape(re.search(r'<p class="gallery-intro">(.*?)</p>', idx, re.S).group(1))
    MANIFEST.write_text(json.dumps(dict(intro=intro, categories=cats, galleries=galleries), indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"bootstrapped {len(galleries)} galleries, {sum(len(g['photos']) for g in galleries)} photos")


# --------------------------------------------------------------------------- shared chrome
HEADER = """    <header class="header">
        <a href="../index.html" class="logo">tapephoto</a>
        <button class="menu-toggle" aria-label="Toggle menu" aria-expanded="false" aria-controls="site-nav">
            <span></span><span></span>
        </button>
        <nav class="nav" id="site-nav">
            <a href="../index.html#work">Work</a>
            <a href="../galleries/">Galleries</a>
            <a href="../services.html">Services</a>
            <a href="../licensing.html">Licensing</a>
            <a href="../blog/">Blog</a>
            <a href="../about.html">About</a>
            <a href="../contact.html">Contact</a>
            <a href="../servicios.html" class="nav-es" lang="es" hreflang="es">Espa&ntilde;ol</a>
        </nav>
    </header>
"""

CTA = """        <section class="gallery-cta">
            <h2>Need coverage like this?</h2>
            <p>Motorsport, events, aerials and commercial work — in Chile and abroad. Archive images available for <a href="../licensing.html">licensing</a>.</p>
            %(license)s            <a class="gallery-btn gallery-btn-ghost" href="../contact.html">Get in touch</a>
            <a class="gallery-btn gallery-btn-ghost" href="https://wa.me/14423854585" target="_blank" rel="noopener">WhatsApp</a>
        </section>
"""
CTA_LICENSE = '<a class="gallery-btn" href="../licensing.html?ref=%s#inquiry">License this event</a>\n'
CTA_PLAIN = '<a class="gallery-btn" href="../contact.html">Get in touch</a>\n'

FOOTER = """    <footer class="footer">
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
                <h3>Navigate</h3>
                <a href="../index.html#work">Work</a>
                <a href="../galleries/">Galleries</a>
                <a href="../services.html">Services</a>
                <a href="../licensing.html">Licensing</a>
                <a href="../about.html">About</a>
                <a href="../contact.html">Contact</a>
            </div>
            <div class="footer-social">
                <h3>Follow</h3>
                <a href="https://www.instagram.com/tapephotocom/" target="_blank" rel="me noopener">Instagram &mdash; @tapephotocom</a>
                <a href="https://www.facebook.com/tapephoto" target="_blank" rel="me noopener">Facebook</a>
            </div>
        </div>
        <div class="footer-bottom">
            <p>&copy; 2026 TapePhoto &mdash; all photographs by Carlos Martinez. All rights reserved. <a href="../licensing.html">Licensing</a></p>
            <p>A <a href="https://dongaston.com/" rel="noopener">Don Gast&oacute;n</a> company</p>
        </div>
    <div class="nwm-credit">Made by <a href="https://netwebmedia.com/?utm_source=tapephoto&amp;utm_medium=footer&amp;utm_campaign=made-by" rel="noopener">NetWebMedia</a> · est. 2006 · <a class="nwm-credit-cta" href="https://netwebmedia.com/free-audit.html?utm_source=tapephoto&amp;utm_medium=footer&amp;utm_campaign=made-by" rel="noopener">Want a site like this? Get a free audit →</a></div>
    </footer>
"""


def head(title, desc, canonical, og_img, og_w, og_h, ld):
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{esc(title)}</title>
    <meta name="description" content="{esc(desc)}">
    <link rel="canonical" href="{canonical}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="TapePhoto">
    <meta property="og:title" content="{esc(title)}">
    <meta property="og:description" content="{esc(desc)}">
    <meta property="og:url" content="{canonical}">
    <meta property="og:image" content="{og_img}">
    <meta property="og:image:width" content="{og_w}">
    <meta property="og:image:height" content="{og_h}">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="icon" href="/favicon.ico" sizes="32x32">
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    <link rel="preload" href="/fonts/inter-300-700.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="preload" href="/fonts/playfair-display-400-700.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="stylesheet" href="../style.css?v={CSS_V}">
    <script type="application/ld+json">
{json.dumps(ld, indent=2, ensure_ascii=False)}
    </script>
    <script src="../analytics.js" defer></script>
</head>
"""


def clip(text, n):
    if len(text) <= n:
        return text
    return text[:n].rsplit(" ", 1)[0].rstrip(",;:—-– ") + "…"


def img_url(g, p, sm=False):
    return f"img/{g['slug']}/{p['file']}{'-sm' if sm else ''}.jpg"


# --------------------------------------------------------------------------- pages
def gallery_page(g, cat, order):
    n = len(g["photos"])
    url = f"{SITE}/galleries/{g['slug']}.html"
    cover = g["photos"][g["cover"]]
    title = f"{g['title']} | TapePhoto Galleries"
    desc = clip(f"{g['title']} — {n} photographs by Carlos Martinez (TapePhoto). {g['intro']}", 170)
    images = []
    for i, p in enumerate(g["photos"], 1):
        images.append({"@type": "ImageObject", "contentUrl": f"{SITE}/galleries/{img_url(g, p)}",
                       "width": p["w"], "height": p["h"], "creator": PERSON,
                       "creditText": "Carlos Martinez / TapePhoto",
                       "copyrightNotice": "© Carlos Martinez — TapePhoto",
                       "name": f"{g['title']}, photo {i}", "caption": p["alt"],
                       "thumbnailUrl": f"{SITE}/galleries/{img_url(g, p, True)}",
                       "encodingFormat": "image/jpeg",
                       "license": LICENSE_PAGE, "acquireLicensePage": f"{LICENSE_PAGE}#inquiry"})
    ld = {"@context": "https://schema.org", "@graph": [
        {"@type": "ImageGallery", "@id": f"{url}#gallery", "name": g["title"], "description": g["intro"], "url": url,
         "author": PERSON, "creator": PERSON, "copyrightHolder": PERSON, "numberOfItems": n,
         "genre": cat["name"], "dateModified": g["updated"], "image": images},
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{SITE}/"},
            {"@type": "ListItem", "position": 2, "name": "Galleries", "item": f"{SITE}/galleries/"},
            {"@type": "ListItem", "position": 3, "name": cat["name"], "item": f"{SITE}/galleries/#{cat['id']}"},
            {"@type": "ListItem", "position": 4, "name": g["title"], "item": url}]}]}
    kicker = " · ".join([g["label"]] + ([g["kicker"]] if g["kicker"] else []) + [f"{n} photos"])
    out = [head(title, desc, url, f"{SITE}/galleries/{img_url(g, cover)}", cover["w"], cover["h"], ld)]
    out.append('<body class="gallery-body">\n' + HEADER + '\n    <main class="gallery-page">\n')
    out.append(f"""        <section class="gallery-hero">
            <nav class="gallery-crumbs" aria-label="Breadcrumb"><a href="../index.html">Home</a> / <a href="./">Galleries</a> / <a href="./#{cat['id']}">{esc(cat['name'])}</a> / <span>{esc(g['title'])}</span></nav>
            <p class="gallery-kicker">{esc(kicker)}</p>
            <h1>{esc(g['title'])}</h1>
            <p class="gallery-intro">{esc(g['intro'])}</p>
        </section>

        <section class="gallery-masonry" aria-label="{esc(g['title'])} photographs">
""")
    for i, p in enumerate(g["photos"], 1):
        out.append(f"""            <figure class="photo-item gallery-item" tabindex="0" role="button" aria-label="Open photo {i} of {n} full size">
                <img src="{img_url(g, p, True)}" data-full="{img_url(g, p)}" alt="{esc(p['alt'])} (photo {i} of {n})" width="{p['sw']}" height="{p['sh']}" loading="{'eager' if i <= 3 else 'lazy'}" decoding="async">
            </figure>
""")
    out.append("        </section>\n\n" + CTA % {"license": CTA_LICENSE % g["slug"]} + """
        <section class="gallery-more">
            <h2>More galleries</h2>
            <div class="gallery-more-links">
""")
    for o in order:
        if o["slug"] != g["slug"]:
            out.append(f'                <a href="{o["slug"]}.html">{esc(o["title"])}</a>\n')
    out.append("""            </div>
        </section>
    </main>

""" + FOOTER + """
    <div class="lightbox" id="lightbox" role="dialog" aria-modal="true" aria-label="Photo viewer">
        <button class="lightbox-close" aria-label="Close">&times;</button>
        <button class="lightbox-prev" aria-label="Previous">&lsaquo;</button>
        <button class="lightbox-next" aria-label="Next">&rsaquo;</button>
        <img src="" alt="" class="lightbox-img">
        <a class="lightbox-license" href="../licensing.html#inquiry">License this photo</a>
    </div>

    <script src="../main.js" defer></script>
</body>
</html>
""")
    return "".join(out)


def card(g, prefix, label, count_text, eager, keywords=False):
    p = g["photos"][g["cover"]]
    kw = ""
    if keywords:
        meta = " · ".join([g["label"]] + ([g["kicker"]] if g["kicker"] else []) + [f"{len(g['photos'])} photos"])
        kw = f' data-keywords="{esc(" ".join([g["title"], g["label"], g["cover_alt"], meta, g["intro"]]).lower())}"'
    return f"""            <a class="gallery-card" href="{prefix}{g['slug']}.html"{kw}>
                <img src="{prefix}{img_url(g, p, True)}" alt="{esc(g['cover_alt'])}" width="{p['sw']}" height="{p['sh']}" loading="{'eager' if eager else 'lazy'}" decoding="async">
                <span class="gallery-card-body">
                    <span class="photo-category">{esc(label)}</span>
                    <span class="gallery-card-title">{esc(g['title'])}</span>
                    <span class="gallery-card-count">{count_text}</span>
                </span>
            </a>
"""


def index_page(M, order, by_cat):
    total = sum(len(g["photos"]) for g in order)
    ncat = len(by_cat)
    names = ", ".join(c["name"].lower() for c in M["categories"])
    desc = f"{total} curated photographs by Carlos Martinez in {len(order)} galleries across {names}."
    first = order[0]
    ld = {"@context": "https://schema.org", "@type": "CollectionPage", "@id": f"{SITE}/galleries/#page",
          "name": "Photo Galleries — TapePhoto", "url": f"{SITE}/galleries/", "author": PERSON,
          "dateModified": max(g["updated"] for g in order),
          "hasPart": [{"@type": "ImageGallery", "name": g["title"], "genre": c["name"],
                       "url": f"{SITE}/galleries/{g['slug']}.html", "numberOfItems": len(g["photos"])}
                      for c in M["categories"] for g in by_cat[c["id"]]]}
    out = [head("Photo Galleries | TapePhoto - Carlos Martinez Photography", desc, f"{SITE}/galleries/",
                f"{SITE}/galleries/{img_url(first, first['photos'][first['cover']])}",
                first["photos"][first["cover"]]["w"], first["photos"][first["cover"]]["h"], ld)]
    jump = " ".join(f'<a href="#{c["id"]}">{esc(c["name"])}</a>' for c in M["categories"])
    out.append('<body class="gallery-body">\n' + HEADER + f"""
    <main class="gallery-page">
        <section class="gallery-hero">
            <nav class="gallery-crumbs" aria-label="Breadcrumb"><a href="../index.html">Home</a> / <span>Galleries</span></nav>
            <p class="gallery-kicker">{total} photographs · {len(order)} galleries · {ncat} categories</p>
            <h1>Galleries</h1>
            <p class="gallery-intro">{esc(M['intro'])}</p>
            <nav class="gallery-jump" aria-label="Categories">{jump}</nav>
        </section>

        <div class="gallery-search" role="search">
            <label for="gallery-search">Search the archive</label>
            <input id="gallery-search" type="search" placeholder="Event, place or subject: rally, Tijuana, aerial, portrait..." autocomplete="off">
            <p id="gallery-search-status" class="gallery-search-status" role="status" aria-live="polite"></p>
        </div>
""")
    first_card = True
    for c in M["categories"]:
        gs = by_cat[c["id"]]
        cnt = sum(len(g["photos"]) for g in gs)
        out.append(f"""
        <section class="gallery-section" id="{c['id']}">
            <div class="gallery-section-head">
                <h2>{esc(c['name'])}</h2>
                <p>{esc(c['blurb'])} · {cnt} photos</p>
            </div>
            <div class="gallery-cards">
""")
        for g in gs:
            out.append(card(g, "", g["label"], f"{len(g['photos'])} photos", first_card, keywords=True))
            first_card = False
        out.append("            </div>\n        </section>")
    out.append("\n\n" + CTA % {"license": CTA_PLAIN} + "    </main>\n\n" + FOOTER + """
    <script src="../main.js" defer></script>
</body>
</html>
""")
    return "".join(out)


def home_block(M, order, by_cat):
    total = sum(len(g["photos"]) for g in order)
    names = ", ".join(c["short"] for c in M["categories"])
    cards = []
    for c in M["categories"]:
        gs = by_cat[c["id"]]
        g = next((x for x in gs if x["slug"] == c.get("home")), gs[0])
        cnt = sum(len(x["photos"]) for x in gs)
        cards.append(card(g, "galleries/", c["name"], f"{cnt} photos in this category", False).replace('href="galleries/', 'href="galleries/', 1))
    return f"""    <!-- Galleries: full event stories, curated from the Facebook albums and the iCloud library (rebuilt by _deploy/galleries/build-galleries.py) -->
    <section id="galleries" class="home-galleries">
        <div class="section-header">
            <h2>Galleries</h2>
            <p>{total} photographs in {len(order)} galleries — {names}</p>
        </div>
        <div class="gallery-cards home-cats">
{''.join(cards)}        </div>
        <div class="home-galleries-all"><a class="gallery-btn gallery-btn-ghost" href="galleries/">View all {len(order)} galleries</a></div>
    </section>
"""


def sitemap(order):
    sm = ROOT / "sitemap.xml"
    s = sm.read_text(encoding="utf-8")
    s = re.sub(r"\s*<url>\s*<loc>https://tapephoto\.com/galleries/[^<]+\.html</loc>.*?</url>", "", s, flags=re.S)
    block = "".join(f"""
  <url>
    <loc>{SITE}/galleries/{g['slug']}.html</loc>
    <lastmod>{g['updated']}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>""" for g in order)
    s = re.sub(r"(<url>\s*<loc>https://tapephoto\.com/galleries/</loc>\s*<lastmod>)[^<]*(</lastmod>.*?</url>)",
               lambda m: m.group(1) + max(g["updated"] for g in order) + m.group(2) + block, s, count=1, flags=re.S)
    sm.write_text(s, encoding="utf-8")


def build():
    M = json.loads(MANIFEST.read_text(encoding="utf-8"))
    cats = {c["id"]: c for c in M["categories"]}
    by_cat = {c["id"]: [g for g in M["galleries"] if g["category"] == c["id"]] for c in M["categories"]}
    order = [g for c in M["categories"] for g in by_cat[c["id"]]]
    for g in order:
        for p in g["photos"]:
            for suffix in ("", "-sm"):
                f = GAL / "img" / g["slug"] / f"{p['file']}{suffix}.jpg"
                if not f.is_file():
                    sys.exit(f"missing image {f}")
        (GAL / f"{g['slug']}.html").write_text(gallery_page(g, cats[g["category"]], order), encoding="utf-8", newline="\n")
    (GAL / "index.html").write_text(index_page(M, order, by_cat), encoding="utf-8", newline="\n")
    home = ROOT / "index.html"
    h = home.read_text(encoding="utf-8")
    h, k = re.subn(r"    <!-- Galleries:.*?</section>\n", lambda _: home_block(M, order, by_cat), h, count=1, flags=re.S)
    if not k:
        sys.exit("homepage gallery block not found")
    home.write_text(h, encoding="utf-8", newline="\n")
    sitemap(order)
    print(f"built {len(order)} galleries, {sum(len(g['photos']) for g in order)} photos, {len(M['categories'])} categories")


if __name__ == "__main__":
    bootstrap() if "--bootstrap" in sys.argv else build()
