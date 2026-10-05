#!/usr/bin/env python3
"""Idempotent site pass for the 2026-10-05 competitive-report backlog (tapephoto.com).

    python _deploy/backfill-seo.py            # apply
    python _deploy/backfill-seo.py --check    # exit 1 if anything would change

What it does:
  1. Licensing inquiry form (usage, media, duration, territory, deadline) on
     licensing.html and licencias.html. It posts through the same NetWebMedia forms API
     as the contact form (main.js), so no new backend. No prices anywhere in the form.
  2. Gallery pages: every ImageObject gets name/caption/thumbnailUrl/encodingFormat plus
     license + acquireLicensePage (the licensing inquiry), a BreadcrumbList, a "License
     this event" button and a "License this photo" link inside the lightbox.
  3. galleries/index.html: keyword search over the archive (event, place, subject).
  4. Home: outcome-first H1/title/description, hero actions, a proof strip made only of
     real events from the galleries, hero + grid srcset, ImageObject list with licence.
  5. servicios/services H1s that name the city; sitemap lastmod.

CSP note: this site forbids inline scripts AND style="" attributes, so nothing here
emits either; behaviour lives in main.js, looks in style.css.
"""
import glob
import html as htmllib
import json
import os
import re
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
SITE = "https://tapephoto.com"
LIC = SITE + "/licensing.html"
LIC_INQ = LIC + "#inquiry"
CHECK = "--check" in sys.argv
changed = []


def read(rel):
    raw = open(os.path.join(ROOT, rel), encoding="utf8", newline="").read()
    nl = "\r\n" if "\r\n" in raw else "\n"
    return raw.replace("\r\n", "\n"), nl


def write(rel, text, nl, orig):
    if text == orig:
        return
    changed.append(rel)
    if not CHECK:
        open(os.path.join(ROOT, rel), "w", encoding="utf8", newline="").write(text.replace("\n", nl))


def esc(s):
    return htmllib.escape(s, quote=True)


# ── 1. Licensing inquiry form ───────────────────────────────────────────────
FORM = {
    "en": {
        "id": "inquiry",
        "h": "Request a licence quote",
        "lead": "Tell me what you need and where it will run. You get a written quote within 24 hours; nothing is charged until you accept the licence.",
        "rights": "Every image is my own work, shot by me and delivered from the original RAW. Where a photo shows identifiable people, teams, performers or trademarks, commercial use is only offered when the releases exist, and I tell you up front which images those are.",
        "f": {
            "name": "Name", "email": "Email", "organization": "Organisation (optional)", "phone": "Phone or WhatsApp (optional)",
            "ref": "Image reference or description", "ref_ph": "e.g. wrc-rally-chile-2019-07.jpg, or: IndyCar night race, panning shot",
            "use": "Type of use", "media": "Where it will appear", "duration": "How long", "territory": "Territory",
            "deadline": "Deadline (optional)", "details": "Anything else (optional)", "details_ph": "Publication, campaign, print run, audience size...",
            "submit": "Send licence request",
        },
        "use": ["Editorial: online article", "Editorial: print", "Book, documentary or broadcast", "Advertising or commercial campaign", "Local business use (Chile)", "Not sure yet"],
        "media": ["Website", "Social media", "Print (magazine, newspaper, book)", "Broadcast or streaming", "Out-of-home or packaging", "Other"],
        "duration": ["One article or one issue", "1 year", "2 to 3 years", "Perpetual", "Not sure yet"],
        "territory": ["Chile", "Latin America", "North America", "Worldwide", "Other"],
        "sent_title": "Licence request sent.",
        "sent_body": "Thanks. I will reply with a written quote within 24 hours.",
        "source": "licensing",
        "pick": "Select...",
    },
    "es": {
        "id": "inquiry",
        "h": "Pide una cotización de licencia",
        "lead": "Cuéntame qué necesitas y dónde se va a usar. Recibes una cotización por escrito dentro de 24 horas; no se cobra nada hasta que aceptes la licencia.",
        "rights": "Todas las imágenes son obra propia, tomadas por mí y entregadas desde el RAW original. Cuando una foto muestra personas identificables, equipos, artistas o marcas, el uso comercial solo se ofrece si existen las autorizaciones, y te aviso de antemano cuáles son.",
        "f": {
            "name": "Nombre", "email": "Correo", "organization": "Organización (opcional)", "phone": "Teléfono o WhatsApp (opcional)",
            "ref": "Referencia de la imagen o descripción", "ref_ph": "p. ej. wrc-rally-chile-2019-07.jpg, o: carrera nocturna de IndyCar, paneo",
            "use": "Tipo de uso", "media": "Dónde aparecerá", "duration": "Por cuánto tiempo", "territory": "Territorio",
            "deadline": "Fecha límite (opcional)", "details": "Algo más (opcional)", "details_ph": "Medio, campaña, tiraje, tamaño de la audiencia...",
            "submit": "Enviar solicitud de licencia",
        },
        "use": ["Editorial: artículo online", "Editorial: impreso", "Libro, documental o televisión", "Publicidad o campaña comercial", "Uso para negocio local (Chile)", "Aún no lo sé"],
        "media": ["Sitio web", "Redes sociales", "Impreso (revista, diario, libro)", "Televisión o streaming", "Vía pública o packaging", "Otro"],
        "duration": ["Un artículo o una edición", "1 año", "2 a 3 años", "Perpetua", "Aún no lo sé"],
        "territory": ["Chile", "Latinoamérica", "Norteamérica", "Mundial", "Otro"],
        "sent_title": "Solicitud enviada.",
        "sent_body": "Gracias. Te respondo con una cotización por escrito dentro de 24 horas.",
        "source": "licencias",
        "pick": "Selecciona...",
    },
}


def select(name, label, options, pick, req=False):
    opts = f'<option value="">{pick}</option>' + "".join(f'<option value="{esc(o)}">{esc(o)}</option>' for o in options)
    return (
        f'                <div class="form-group">\n'
        f'                    <label for="lic-{name}">{label}</label>\n'
        f'                    <select id="lic-{name}" name="{name}"{" required" if req else ""}>{opts}</select>\n'
        f'                </div>\n'
    )


def inquiry_section(lang):
    c = FORM[lang]
    f = c["f"]
    return f"""        <section class="lic-inquiry" id="inquiry" aria-labelledby="inquiry-h">
            <div class="lic-inquiry-inner">
                <h2 id="inquiry-h">{c['h']}</h2>
                <p class="lic-inquiry-lead">{c['lead']}</p>
                <p class="lic-inquiry-rights">{c['rights']}</p>
                <form class="contact-form lic-form" data-source="{c['source']}" data-licence="1" data-sent-title="{esc(c['sent_title'])}" data-sent-body="{esc(c['sent_body'])}">
                    <div class="form-group">
                        <label for="lic-name">{f['name']}</label>
                        <input id="lic-name" type="text" name="name" autocomplete="name" required>
                    </div>
                    <div class="form-group">
                        <label for="lic-email">{f['email']}</label>
                        <input id="lic-email" type="email" name="email" autocomplete="email" required>
                    </div>
                    <div class="form-group">
                        <label for="lic-organization">{f['organization']}</label>
                        <input id="lic-organization" type="text" name="organization" autocomplete="organization">
                    </div>
                    <div class="form-group">
                        <label for="lic-phone">{f['phone']}</label>
                        <input id="lic-phone" type="tel" name="phone" autocomplete="tel">
                    </div>
                    <div class="form-group wide">
                        <label for="lic-ref">{f['ref']}</label>
                        <textarea id="lic-ref" name="ref" rows="3" placeholder="{esc(f['ref_ph'])}" required></textarea>
                    </div>
{select('use', f['use'], c['use'], c['pick'], True)}{select('media', f['media'], c['media'], c['pick'], True)}{select('duration', f['duration'], c['duration'], c['pick'], True)}{select('territory', f['territory'], c['territory'], c['pick'], True)}                    <div class="form-group">
                        <label for="lic-deadline">{f['deadline']}</label>
                        <input id="lic-deadline" type="date" name="deadline">
                    </div>
                    <div class="form-group wide">
                        <label for="lic-details">{f['details']}</label>
                        <textarea id="lic-details" name="details" rows="3" placeholder="{esc(f['details_ph'])}"></textarea>
                    </div>
                    <input type="text" name="nwm_hp_2" class="hp-field" tabindex="-1" autocomplete="off" aria-hidden="true">
                    <div class="form-status" role="status" aria-live="polite" hidden></div>
                    <button type="submit" class="submit-btn">{f['submit']}</button>
                </form>
            </div>
        </section>

"""


def patch_licence_pages():
    for rel, lang, anchor in (("licensing.html", "en", '        <section class="faq-section">'), ("licencias.html", "es", '        <section class="faq-section">')):
        text, nl = read(rel)
        orig = text
        if 'id="inquiry"' not in text:
            assert anchor in text, rel
            text = text.replace(anchor, inquiry_section(lang) + anchor, 1)
        write(rel, text, nl, orig)


# ── 2. Gallery pages ────────────────────────────────────────────────────────
LD_RE = re.compile(r'(<script type="application/ld\+json">\n)(.*?)(\n\s*</script>)', re.S)


def alt_map(text):
    out = {}
    for m in re.finditer(r'<img src="[^"]*" data-full="([^"]+)" alt="([^"]*)"', text):
        out[m.group(1)] = re.sub(r"\s*\(photo \d+ of \d+\)\s*$", "", htmllib.unescape(m.group(2)))
    return out


def patch_gallery(rel):
    text, nl = read(rel)
    orig = text
    slug = os.path.basename(rel)[:-5]
    title = htmllib.unescape(re.search(r"<h1>(.*?)</h1>", text, re.S).group(1)).strip()
    alts = alt_map(text)

    m = LD_RE.search(text)
    data = json.loads(m.group(2))
    graph = data["@graph"]
    gallery = next(n for n in graph if n.get("@type") == "ImageGallery")
    for img in gallery.get("image", []):
        rel_file = img["contentUrl"].replace(SITE + "/galleries/", "")
        n = re.search(r"-(\d+)\.jpg$", rel_file)
        caption = alts.get(rel_file, "")
        img.setdefault("name", f"{title}, photo {int(n.group(1))}" if n else title)
        if caption:
            img.setdefault("caption", caption)
        img.setdefault("thumbnailUrl", img["contentUrl"].replace(".jpg", "-sm.jpg"))
        img.setdefault("encodingFormat", "image/jpeg")
        img["license"] = LIC
        img["acquireLicensePage"] = LIC_INQ
    if not any(n.get("@type") == "BreadcrumbList" for n in graph):
        graph.append({
            "@type": "BreadcrumbList",
            "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Home", "item": SITE + "/"},
                {"@type": "ListItem", "position": 2, "name": "Galleries", "item": SITE + "/galleries/"},
                {"@type": "ListItem", "position": 3, "name": title, "item": f"{SITE}/galleries/{slug}.html"},
            ],
        })
    body = json.dumps(data, indent=2, ensure_ascii=False)
    text = text[: m.start(2)] + body + text[m.end(2):]

    # CTA: licence this event (prefilled reference)
    cta_old = '<a class="gallery-btn" href="../contact.html">Get in touch</a>'
    if cta_old in text and "License this event" not in text:
        text = text.replace(
            cta_old,
            f'<a class="gallery-btn" href="../licensing.html?ref={slug}#inquiry">License this event</a>\n            ' + cta_old.replace('class="gallery-btn"', 'class="gallery-btn gallery-btn-ghost"'),
            1,
        )
    # Lightbox: licence the photo on screen
    lb_old = '        <img src="" alt="" class="lightbox-img">\n    </div>'
    if lb_old in text and "lightbox-license" not in text:
        text = text.replace(
            lb_old,
            '        <img src="" alt="" class="lightbox-img">\n        <a class="lightbox-license" href="../licensing.html#inquiry">License this photo</a>\n    </div>',
            1,
        )
    write(rel, text, nl, orig)


# ── 3. Gallery index search ─────────────────────────────────────────────────
def patch_gallery_index():
    rel = "galleries/index.html"
    text, nl = read(rel)
    orig = text
    kick = {}
    for g in glob.glob(os.path.join(ROOT, "galleries", "*.html")):
        name = os.path.basename(g)
        if name == "index.html":
            continue
        t = open(g, encoding="utf8").read()
        k = re.search(r'<p class="gallery-kicker">(.*?)</p>', t, re.S)
        i = re.search(r'<p class="gallery-intro">(.*?)</p>', t, re.S)
        kick[name] = (htmllib.unescape(re.sub(r"<[^>]+>", "", (k.group(1) if k else ""))) + " " + htmllib.unescape(re.sub(r"<[^>]+>", "", (i.group(1) if i else ""))))[:400]

    out, pos = [], 0
    for m in re.finditer(r'<a class="gallery-card" href="([^"]+)">(.*?)</a>', text, re.S):
        href, inner = m.group(1), m.group(2)
        out.append(text[pos:m.start()])
        title = re.search(r'gallery-card-title">(.*?)</span>', inner, re.S)
        cat = re.search(r'photo-category">(.*?)</span>', inner, re.S)
        alt = re.search(r'alt="([^"]*)"', inner)
        words = " ".join([
            htmllib.unescape(title.group(1)) if title else "",
            htmllib.unescape(cat.group(1)) if cat else "",
            htmllib.unescape(alt.group(1)) if alt else "",
            kick.get(href, ""),
        ])
        words = re.sub(r"\s+", " ", words).strip().lower()
        out.append(f'<a class="gallery-card" href="{href}" data-keywords="{esc(words)}">{inner}</a>')
        pos = m.end()
    out.append(text[pos:])
    text = "".join(out)

    search = """        <div class="gallery-search" role="search">
            <label for="gallery-search">Search the archive</label>
            <input id="gallery-search" type="search" placeholder="Event, place or subject: rally, Tijuana, aerial, portrait..." autocomplete="off">
            <p id="gallery-search-status" class="gallery-search-status" role="status" aria-live="polite"></p>
        </div>
"""
    if 'id="gallery-search"' not in text:
        m = re.search(r'(            <nav class="gallery-jump".*?</nav>\n        </section>\n)', text, re.S)
        assert m, "gallery-jump nav not found"
        text = text[: m.end()] + "\n" + search + text[m.end():]
    write(rel, text, nl, orig)


# ── 4. Home ─────────────────────────────────────────────────────────────────
HOME_TITLE = "Photography in La Serena &amp; Coquimbo + Licensable Motorsport Archive | TapePhoto"
HOME_DESC = "Photography for businesses in La Serena and Coquimbo, and a licensable motorsport archive: WRC, IndyCar and enduro, concerts, aerial and travel. By Carlos Martinez, Coquimbo, Chile."
HOME_H1 = "Photography for businesses in La Serena and Coquimbo, plus a licensable motorsport archive"
PROOF = [
    ("WRC Rally Chile 2019", "galleries/wrc-rally-chile-2019.html"),
    ("Grand Prix of Long Beach 2018", "galleries/indycar-long-beach-2018.html"),
    ("Rally Raid, Atacama", "galleries/rally-raid-atacama.html"),
    ("ISDE Chile", "galleries/isde-chile-enduro.html"),
    ("Opening Day at Del Mar", "galleries/del-mar-opening-day-2018.html"),
    ("Lebowski Fest, Los Angeles", "galleries/lebowski-fest-la-2013.html"),
]


def jpg_size(rel):
    from PIL import Image
    with Image.open(os.path.join(ROOT, rel)) as im:
        return im.size


def patch_home():
    rel = "index.html"
    text, nl = read(rel)
    orig = text

    text = re.sub(r"<title>[^<]*</title>", f"<title>{HOME_TITLE}</title>", text, count=1)
    text = re.sub(r'(<meta name="description" content=")[^"]*(">)', lambda m: m.group(1) + HOME_DESC + m.group(2), text, count=1)
    text = re.sub(r'(<meta property="og:title" content=")[^"]*(">)', lambda m: m.group(1) + HOME_TITLE.replace("&amp;", "&amp;") + m.group(2), text, count=1)
    text = re.sub(r'(<meta property="og:description" content=")[^"]*(">)', lambda m: m.group(1) + HOME_DESC + m.group(2), text, count=1)

    if "hero-actions" not in text:
        old = '            <h1>Carlos Martinez</h1>\n            <p class="hero-subtitle">Photographer &mdash; Motorsport / Concerts / Aerial / Street</p>\n'
        assert old in text
        new = (
            f'            <h1 class="hero-h1">{HOME_H1}</h1>\n'
            '            <p class="hero-subtitle">Carlos Martinez &mdash; Photographer in Coquimbo, Chile</p>\n'
            '            <div class="hero-actions">\n'
            '                <a class="gallery-btn" href="services.html">Photography for your business</a>\n'
            '                <a class="gallery-btn gallery-btn-ghost" href="licensing.html#inquiry">License from the archive</a>\n'
            '            </div>\n'
        )
        text = text.replace(old, new, 1)

    # Proof strip: only real events that have a gallery on this site
    if "proof-strip" not in text:
        links = " &middot; ".join(f'<a href="{href}">{esc(name)}</a>' for name, href in PROOF)
        strip = (
            '    <section class="proof-strip" aria-label="Where the archive comes from">\n'
            '        <p class="proof-lead">Photographed on location, 389 frames in 17 galleries. Archive highlights:</p>\n'
            f'        <p class="proof-list">{links}</p>\n'
            '    </section>\n\n'
        )
        marker = "    <!-- Full-bleed photo grid"
        assert marker in text
        text = text.replace(marker, strip + marker, 1)

    # Hero LCP srcset + grid srcset (only where the -640 / -800 files exist)
    def add_srcset(m):
        tag = m.group(0)
        if "srcset=" in tag:
            return tag
        src = re.search(r'src="images/([^"]+)\.jpg"', tag).group(1)
        width = int(re.search(r'width="(\d+)"', tag).group(1))
        for w in (640, 800):
            small = f"images/{src}-{w}.jpg"
            if os.path.exists(os.path.join(ROOT, small)) and w < width:
                sizes = "100vw" if "hero-img" in tag else "(max-width: 800px) 100vw, 50vw"
                return tag.replace(f'src="images/{src}.jpg"', f'src="images/{src}.jpg" srcset="{small} {w}w, images/{src}.jpg {width}w" sizes="{sizes}"', 1)
        return tag
    text = re.sub(r'<img src="images/[^"]+\.jpg"[^>]*>', add_srcset, text)

    # Person.sameAs / Service already exist; add a licensable ImageObject list for the grid
    if '"@type": "ImageObject"' not in text.split("<body>")[0]:
        imgs = []
        for m in re.finditer(r'<img src="images/(tape_[a-z_]+)\.jpg"[^>]*alt="([^"]*)"[^>]*width="(\d+)" height="(\d+)"', text):
            name, alt, w, h = m.groups()
            imgs.append({
                "@type": "ImageObject",
                "contentUrl": f"{SITE}/images/{name}.jpg",
                "name": htmllib.unescape(alt),
                "caption": htmllib.unescape(alt),
                "width": int(w), "height": int(h),
                "encodingFormat": "image/jpeg",
                "creator": {"@type": "Person", "@id": SITE + "/#carlos", "name": "Carlos Martinez", "url": SITE + "/"},
                "creditText": "Carlos Martinez / TapePhoto",
                "copyrightNotice": "© Carlos Martinez — TapePhoto",
                "license": LIC,
                "acquireLicensePage": LIC_INQ,
            })
        if imgs:
            block = {"@context": "https://schema.org", "@type": "ImageGallery", "name": "TapePhoto selected work", "url": SITE + "/#work", "image": imgs}
            ld = '    <script type="application/ld+json">\n' + json.dumps(block, indent=2, ensure_ascii=False) + "\n    </script>\n"
            text = text.replace("    <!-- Analytics:", ld + "    <!-- Analytics:", 1)
    write(rel, text, nl, orig)


def patch_service_h1s():
    for rel, old, new in (
        ("services.html", "<h1>photography services.</h1>", "<h1>photography for businesses in La Serena and Coquimbo.</h1>"),
        ("servicios.html", "<h1>servicios de fotograf&iacute;a.</h1>", "<h1>fotograf&iacute;a para negocios en La Serena y Coquimbo.</h1>"),
    ):
        text, nl = read(rel)
        orig = text
        text = text.replace(old, new, 1)
        write(rel, text, nl, orig)


def patch_sitemap():
    text, nl = read("sitemap.xml")
    orig = text
    for loc in ("https://tapephoto.com/", "https://tapephoto.com/licensing.html", "https://tapephoto.com/licencias.html", "https://tapephoto.com/galleries/", "https://tapephoto.com/services.html", "https://tapephoto.com/servicios.html"):
        text = re.sub(r"(<loc>" + re.escape(loc) + r"</loc>\s*<lastmod>)[^<]+", r"\g<1>2026-10-05", text, count=1)
    for g in glob.glob(os.path.join(ROOT, "galleries", "*.html")):
        loc = f"{SITE}/galleries/{os.path.basename(g)}"
        text = re.sub(r"(<loc>" + re.escape(loc) + r"</loc>\s*<lastmod>)[^<]+", r"\g<1>2026-10-05", text, count=1)
    write("sitemap.xml", text, nl, orig)


# ── 6. Licensing copy: no prices ────────────────────────────────────────────
# Carlos's rule (2026-10-05): no amounts, rates or payment terms in anything a prospect reads;
# prices live on the invoice. The licensing pages carried a rate card, so they say "quoted per
# image" and describe scope instead. (Service pages and schema Offers are a separate decision.)
LICENCE_COPY = {
    "licensing.html": [
        ("From USD $75 per image ", "Quoted per image "),
        ("From USD $150 per image ", "Quoted per image "),
        ("Books, textbooks and exhibitions: from USD $300 per image", "Books, textbooks and exhibitions: quoted per image"),
        ("Documentary, broadcast and streaming: from USD $350 per image", "Documentary, broadcast and streaming: quoted per image"),
        ("From CLP $60,000 per image ", "Quoted per image "),
        ("Sets of 10 or more: from CLP $450,000", "Sets of 10 or more: quoted as a set"),
        ("Rate card, usage terms and a 24-hour quote.", "Licence types, usage terms and a 24-hour quote."),
        ("Rate card and 24-hour quotes.", "Licence types and 24-hour quotes."),
        ("Unlicensed use is invoiced at three times the applicable rate.", "Unlicensed use is invoiced retroactively under the applicable licence terms."),
    ],
    "licencias.html": [
        ("Desde USD $75 por imagen ", "Cotizaci&oacute;n por imagen "),
        ("Desde USD $150 por imagen ", "Cotizaci&oacute;n por imagen "),
        ("Libros, textos de estudio y exposiciones: desde USD $300 por imagen", "Libros, textos de estudio y exposiciones: cotizaci&oacute;n por imagen"),
        ("Documental, televisi&oacute;n y streaming: desde USD $350 por imagen", "Documental, televisi&oacute;n y streaming: cotizaci&oacute;n por imagen"),
        ("Desde CLP $60.000 por imagen ", "Cotizaci&oacute;n por imagen "),
        ("Sets de 10 o m&aacute;s im&aacute;genes: desde CLP $450.000", "Sets de 10 o m&aacute;s im&aacute;genes: cotizaci&oacute;n por set"),
        ("Tarifas, condiciones de uso y cotizaci&oacute;n en 24 horas.", "Tipos de licencia, condiciones de uso y cotizaci&oacute;n en 24 horas."),
        ("El uso sin licencia se factura al triple de la tarifa", "El uso sin licencia se factura de forma retroactiva seg&uacute;n la licencia"),
    ],
}


def patch_licence_copy():
    for rel, pairs in LICENCE_COPY.items():
        text, nl = read(rel)
        orig = text
        for old, new in pairs:
            text = text.replace(old, new)
        write(rel, text, nl, orig)


CSS_V = "20261005"


def patch_footer_headings():
    """Footer column titles were <h4> straight after an <h1>/<h2>: Lighthouse heading-order failure on every page."""
    rels = [os.path.relpath(p, ROOT).replace(os.sep, "/") for p in glob.glob(os.path.join(ROOT, "**", "*.html"), recursive=True)]
    rels.append("_deploy/blog-publish.js")
    pat = re.compile(r"<h4>(Navigate|Follow|S&iacute;gueme|Navegaci&oacute;n)</h4>")
    for rel in rels:
        if rel.startswith("_deploy/") and not rel.endswith("blog-publish.js"):
            continue
        text, nl = read(rel)
        orig = text
        text = pat.sub(r"<h2></h2>", text)
        write(rel, text, nl, orig)



def patch_css_version():
    """style.css is cached 5 min with ?v= as the buster; bump it everywhere the new rules matter."""
    rels = [os.path.relpath(p, ROOT).replace(os.sep, "/") for p in glob.glob(os.path.join(ROOT, "**", "*.html"), recursive=True)]
    rels += ["_deploy/blog-publish.js"]
    for rel in rels:
        if rel.startswith("_deploy/") and not rel.endswith("blog-publish.js"):
            continue
        text, nl = read(rel)
        orig = text
        text = re.sub(r"style\.css\?v=\d{8}[a-z]?", f"style.css?v={CSS_V}", text)
        write(rel, text, nl, orig)


def main():
    patch_licence_pages()
    for g in sorted(glob.glob(os.path.join(ROOT, "galleries", "*.html"))):
        if os.path.basename(g) != "index.html":
            patch_gallery(os.path.relpath(g, ROOT).replace(os.sep, "/"))
    patch_gallery_index()
    patch_home()
    patch_service_h1s()
    patch_sitemap()
    patch_licence_copy()
    patch_css_version()
    patch_footer_headings()
    print(f"{'would change' if CHECK else 'changed'} {len(changed)} file(s)")
    if CHECK and changed:
        for c in changed[:20]:
            print("  stale:", c)
        sys.exit(1)


if __name__ == "__main__":
    main()
