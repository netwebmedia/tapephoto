#!/usr/bin/env python3
"""Export curated originals into galleries/img/<slug>/ as web renditions.

    python _deploy/galleries/export-photos.py selection.json

selection.json: [{"slug": "...", "start": 18, "photos": [{"src": "<original path>",
                  "crop": [x0, y0, x1, y1] (optional, fractions of the oriented frame),
                  "alt": "...", "year": 2023, "camera": "Apple iPhone 13 Pro"}]}]

Per photo:
  * decode (JPEG / HEIC / DNG), apply EXIF orientation, optional crop
  * convert from the embedded ICC profile (iPhone = Display P3) to sRGB and embed sRGB
  * 1600px and 800px long edge, Lanczos, light output sharpening, progressive JPEG
  * NO camera EXIF survives: no GPS, no serials, no maker notes
  * IPTC + XMP rights metadata written with exiftool (creator, credit line, copyright
    notice, web statement of rights, licensor URL, caption) — the fields Google Images
    reads for its "Licensable" badge and that survive most re-hosting.
Prints credits.json entries for the exported files on stdout.
"""
import io, json, os, re, subprocess, sys, tempfile
from pathlib import Path
from PIL import Image, ImageCms, ImageFilter, ImageOps

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    pass

ROOT = Path(__file__).resolve().parents[2]
IMG = ROOT / "galleries" / "img"
SRGB = ImageCms.createProfile("sRGB")
SRGB_BYTES = ImageCms.ImageCmsProfile(SRGB).tobytes()
LICENSE = "https://tapephoto.com/licensing.html"


def load(src):
    if src.lower().endswith(".dng"):
        import rawpy
        with rawpy.imread(src) as r:
            a = r.postprocess(use_camera_wb=True, output_color=rawpy.ColorSpace.sRGB, output_bps=8, no_auto_bright=False)
        return Image.fromarray(a)          # already sRGB
    im = Image.open(src)
    icc = im.info.get("icc_profile")
    im = ImageOps.exif_transpose(im)
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGB")
    if icc:
        try:
            im = ImageCms.profileToProfile(im, ImageCms.ImageCmsProfile(io.BytesIO(icc)), SRGB,
                                           renderingIntent=ImageCms.Intent.PERCEPTUAL, outputMode="RGB")
        except Exception:
            im = im.convert("RGB")
    return im.convert("RGB")


def rendition(im, long_edge, out, quality):
    w, h = im.size
    s = long_edge / max(w, h)
    r = im.resize((round(w * s), round(h * s)), Image.LANCZOS) if s < 1 else im.copy()
    r = r.filter(ImageFilter.UnsharpMask(radius=0.6, percent=45, threshold=2))
    r.save(out, "JPEG", quality=quality, optimize=True, progressive=True, subsampling="4:2:0", icc_profile=SRGB_BYTES)
    return r.size


def rights(files, alt, year):
    notice = f"© {year + ' ' if year else ''}Carlos Martinez — TapePhoto. All rights reserved."
    args = ["-q", "-overwrite_original", "-codedcharacterset=utf8", "-charset", "iptc=utf8",
            "-XMP-dc:Creator=Carlos Martinez", f"-XMP-dc:Rights={notice}", f"-XMP-dc:Description={alt}",
            "-XMP-photoshop:Credit=Carlos Martinez / TapePhoto", "-XMP-xmpRights:Marked=True",
            f"-XMP-xmpRights:WebStatement={LICENSE}", "-XMP-iptcCore:CreatorWorkURL=https://tapephoto.com/",
            f"-XMP-plus:LicensorName=TapePhoto", f"-XMP-plus:LicensorURL={LICENSE}",
            "-XMP-plus:CopyrightOwnerName=Carlos Martinez",
            "-IPTC:By-line=Carlos Martinez", "-IPTC:Credit=Carlos Martinez / TapePhoto",
            f"-IPTC:CopyrightNotice={notice}", f"-IPTC:Caption-Abstract={alt}",
            "-EXIF:Artist=Carlos Martinez", f"-EXIF:Copyright={notice}"] + [str(f) for f in files]
    # argv on Windows goes through the ANSI code page and mangles © and —; an argfile is read as UTF-8
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".args", delete=False) as t:
        t.write("\n".join(args) + "\n")
    try:
        subprocess.run(["exiftool", "-@", t.name], check=True, stdin=subprocess.DEVNULL)
    finally:
        os.unlink(t.name)


def backfill():
    """Write the rights block onto every image already listed in manifest.json."""
    m = json.loads((Path(__file__).with_name("manifest.json")).read_text(encoding="utf-8"))
    for g in m["galleries"]:
        yr = re.search(r"(20\d\d)", g["slug"] + " " + g.get("kicker", ""))
        for p in g["photos"]:
            d = IMG / g["slug"]
            rights([d / f"{p['file']}.jpg", d / f"{p['file']}-sm.jpg"], p["alt"], yr.group(1) if yr else "")
        print("rights:", g["slug"], len(g["photos"]), file=sys.stderr)


def main():
    if sys.argv[1] == "--backfill":
        return backfill()
    sel = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    credits = []
    for g in sel:
        d = IMG / g["slug"]
        d.mkdir(parents=True, exist_ok=True)
        for i, p in enumerate(g["photos"], g.get("start", 1)):
            name = f"{g['slug']}-{i:02d}"
            im = load(p["src"])
            if p.get("crop"):
                x0, y0, x1, y1 = p["crop"]
                W, H = im.size
                im = im.crop((round(x0 * W), round(y0 * H), round(x1 * W), round(y1 * H)))
            full = d / f"{name}.jpg"
            sm = d / f"{name}-sm.jpg"
            fw, fh = rendition(im, 1600, full, 84)
            sw, sh = rendition(im, 800, sm, 80)
            rights([full, sm], p["alt"], str(p["year"]))
            credits.append(dict(file=f"/galleries/img/{g['slug']}/{name}.jpg", gallery=g["slug"], width=fw, height=fh,
                                author="Carlos Martinez (TapePhoto)", license="TapePhoto own work",
                                license_url="https://tapephoto.com/", kind="own",
                                source="iCloud Photos library — original camera file",
                                camera=p.get("camera", ""), captured=str(p["year"]),
                                crop="re-cropped for composition" if p.get("crop") else "full frame",
                                sw=sw, sh=sh))
            print(name, fw, fh, file=sys.stderr)
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(credits, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
