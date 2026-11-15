"""Generate the app icons: a white dumbbell on the accent colour.

One-off tool, Python standard library only. Run from the repo root:

    py tools/make_icons.py

Writes icons/icon-180.png (apple-touch-icon), icon-192.png, icon-512.png and
icon-maskable-512.png (glyph kept inside the maskable safe zone).
"""

import struct
import zlib
from pathlib import Path

ACCENT = (0x4F, 0x5B, 0xD5)
WHITE = (0xFF, 0xFF, 0xFF)

# Rounded rectangles in a 0..1 square: (x0, y0, x1, y1, corner radius).
GLYPH = [
    (0.20, 0.470, 0.80, 0.530, 0.020),  # bar
    (0.275, 0.300, 0.365, 0.700, 0.028),  # inner plate, left
    (0.635, 0.300, 0.725, 0.700, 0.028),  # inner plate, right
    (0.170, 0.370, 0.245, 0.630, 0.026),  # outer plate, left
    (0.755, 0.370, 0.830, 0.630, 0.026),  # outer plate, right
]


def rounded_rect_distance(px, py, rect):
    """Signed distance from a point to a rounded rectangle (negative inside)."""
    x0, y0, x1, y1, r = rect
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    hx, hy = (x1 - x0) / 2 - r, (y1 - y0) / 2 - r
    dx, dy = abs(px - cx) - hx, abs(py - cy) - hy
    outside = (max(dx, 0.0) ** 2 + max(dy, 0.0) ** 2) ** 0.5
    inside = min(max(dx, dy), 0.0)
    return outside + inside - r


def render(size, glyph_scale):
    rows = []
    for y in range(size):
        row = bytearray([0])  # PNG filter type 0 for this row
        for x in range(size):
            # Pixel centre in glyph space, scaled around the icon centre.
            u = ((x + 0.5) / size - 0.5) / glyph_scale + 0.5
            v = ((y + 0.5) / size - 0.5) / glyph_scale + 0.5
            dist = min(rounded_rect_distance(u, v, rect) for rect in GLYPH)
            # Anti-alias over one pixel.
            coverage = min(max(0.5 - dist * size * glyph_scale, 0.0), 1.0)
            for bg, fg in zip(ACCENT, WHITE):
                row.append(round(bg + (fg - bg) * coverage))
        rows.append(bytes(row))
    return b"".join(rows)


def chunk(kind, data):
    body = kind + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


def write_png(path, size, glyph_scale):
    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit RGB, opaque
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(render(size, glyph_scale), 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)
    print(f"wrote {path} ({len(png)} bytes)")


def main():
    out = Path(__file__).resolve().parent.parent / "icons"
    out.mkdir(exist_ok=True)
    write_png(out / "icon-180.png", 180, 1.0)
    write_png(out / "icon-192.png", 192, 1.0)
    write_png(out / "icon-512.png", 512, 1.0)
    write_png(out / "icon-maskable-512.png", 512, 0.78)


if __name__ == "__main__":
    main()
