#!/usr/bin/env python3
"""Generate the application icon: a fretboard with a pentatonic box on it.

Writes a PNG at the requested size using only the standard library, so the
release build needs no image tooling beyond what macOS already ships.
Colours are the application's own palette.
"""
import struct
import sys
import zlib

PAPER = (0xF2, 0xEF, 0xE6)
INK = (0x15, 0x16, 0x1A)
PINK = (0xFF, 0x48, 0xB0)
BLUE = (0x0F, 0x6F, 0xC5)

# Box 1 of the minor pentatonic: (string, fret) with fret 0 as the box's left edge.
BOX = [(s, f) for s, pair in enumerate([(0, 3), (0, 3), (0, 2), (0, 2), (0, 2), (0, 3)]) for f in pair]
ROOTS = {(5, 0), (3, 2), (0, 0)}


def render(size):
    """Return a size x size RGB pixel buffer as a list of rows of (r, g, b)."""
    px = [[PAPER] * size for _ in range(size)]
    ss = size / 1024.0  # design at 1024 and scale

    def rect(x0, y0, x1, y1, colour):
        for y in range(max(0, int(y0)), min(size, int(y1) + 1)):
            row = px[y]
            for x in range(max(0, int(x0)), min(size, int(x1) + 1)):
                row[x] = colour

    def disc(cx, cy, r, colour):
        r2 = r * r
        for y in range(max(0, int(cy - r)), min(size, int(cy + r) + 1)):
            row = px[y]
            dy2 = (y - cy) ** 2
            for x in range(max(0, int(cx - r)), min(size, int(cx + r) + 1)):
                if (x - cx) ** 2 + dy2 <= r2:
                    row[x] = colour

    # rounded-square ink border
    m = 60 * ss
    rect(m, m, size - m, size - m, INK)
    rect(m + 26 * ss, m + 26 * ss, size - m - 26 * ss, size - m - 26 * ss, PAPER)

    # four fret spaces and six strings, centred in the 1024 design square
    fret_w, string_h = 150 * ss, 120 * ss
    left = (size - 4 * fret_w) / 2
    top = (size - 5 * string_h) / 2
    right = left + 4 * fret_w

    # nut, then the four frets that bound the box
    rect(left - 20 * ss, top - 40 * ss, left, top + 5 * string_h + 40 * ss, INK)
    for i in range(1, 5):
        x = left + i * fret_w
        rect(x - 5 * ss, top - 40 * ss, x + 5 * ss, top + 5 * string_h + 40 * ss, INK)
    # six strings, thickening toward the low E
    for s in range(6):
        y = top + s * string_h
        half = (3 + s * 1.7) * ss
        rect(left - 20 * ss, y - half, right, y + half, INK)

    # the box: roots pink, everything else blue, each with an offset shadow dot
    for s, f in BOX:
        cx = left + (f + 0.5) * fret_w
        cy = top + s * string_h
        colour = PINK if (s, f) in ROOTS else BLUE
        shadow = BLUE if colour is PINK else PINK
        disc(cx + 10 * ss, cy + 10 * ss, 46 * ss, shadow)
        disc(cx, cy, 46 * ss, colour)
    return px


def write_png(path, px):
    size = len(px)
    raw = b"".join(b"\x00" + bytes(v for pixel in row for v in pixel) for row in px)

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(png)


if __name__ == "__main__":
    out, size = sys.argv[1], int(sys.argv[2])
    write_png(out, render(size))
    print(f"{out} ({size}x{size})")
