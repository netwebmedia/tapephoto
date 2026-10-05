#!/usr/bin/env python3
"""Generate responsive + modern-format siblings for the portfolio photos.

    python _deploy/build-photo-variants.py

1. images/<name>-800.jpg  (and -640.jpg for the hero): width-capped JPEG copies so the
   homepage can use srcset instead of shipping 1600px frames to a phone.
2. <file>.jpg.avif and <file>.jpg.webp next to every JPEG in images/ and every
   galleries/img/**/*-sm.jpg grid thumbnail. .htaccess answers a request for x.jpg with
   x.jpg.avif / x.jpg.webp when the browser's Accept header allows it, so no <picture>
   markup is needed and the .jpg stays the universal fallback (og:image, lightbox,
   ImageObject contentUrl).

The full-size gallery frames (galleries/img/**/NN.jpg, opened only in the lightbox) are
left as JPEG on purpose: they are the licensable originals-for-preview and ~90 MB.

Idempotent: skips an output newer than its source. Needs Pillow with AVIF + WebP.
"""
import glob
import os
import sys

from PIL import Image

BASE = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
RESIZE = {  # source -> list of widths
    "images/jackblack_lebowski.jpg": [640],
}
RESIZE_ALL_IMAGES = [800]  # every images/tape_*.jpg wider than 1000px


def newer(dst, src):
    return os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src)


def save_variants(path, stats):
    with Image.open(path) as im:
        im.load()
        rgb = im.convert("RGB")
    for ext, kwargs in (("avif", {"quality": 55, "speed": 6}), ("webp", {"quality": 78, "method": 6})):
        dst = f"{path}.{ext}"
        if not newer(dst, path):
            rgb.save(dst, ext.upper(), **kwargs)
            stats["made"] += 1
    stats["jpg"] += os.path.getsize(path)
    stats["best"] += min(os.path.getsize(f"{path}.avif"), os.path.getsize(f"{path}.webp"))


def resized(src, width, stats):
    stem, ext = os.path.splitext(src)
    dst = f"{stem}-{width}{ext}"
    if newer(dst, src):
        return dst
    with Image.open(src) as im:
        if im.width <= width:
            return None
        h = round(im.height * width / im.width)
        im.convert("RGB").resize((width, h), Image.LANCZOS).save(dst, "JPEG", quality=82, optimize=True, progressive=True)
    stats["resized"] += 1
    return dst


def main() -> int:
    stats = {"made": 0, "jpg": 0, "best": 0, "resized": 0}
    images = sorted(glob.glob(os.path.join(BASE, "images", "*.jpg")))
    originals = [p for p in images if not os.path.splitext(p)[0].rsplit("-", 1)[-1].isdigit()]
    derived = []
    for src in originals:
        rel = os.path.relpath(src, BASE).replace(os.sep, "/")
        widths = list(RESIZE.get(rel, []))
        with Image.open(src) as im:
            if im.width > 1000:
                widths += [w for w in RESIZE_ALL_IMAGES if w not in widths]
        for w in widths:
            out = resized(src, w, stats)
            if out:
                derived.append(out)
    targets = sorted(set(originals + derived))
    targets += sorted(glob.glob(os.path.join(BASE, "galleries", "img", "*", "*-sm.jpg")))
    for p in targets:
        save_variants(p, stats)
    print(
        f"resized {stats['resized']} jpgs, wrote {stats['made']} avif/webp; "
        f"jpg {stats['jpg']/1e6:.1f} MB -> best modern {stats['best']/1e6:.1f} MB"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
