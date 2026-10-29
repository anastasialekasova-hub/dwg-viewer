#!/usr/bin/env python3
"""Synthetic size fixtures for TZ 4.2.4 / 4.2.9 (dev only, not shipped).

Usage: tools/.venv/bin/python -I tools/e2e/e1/gen-sizes.py <out_dir> <name>:<entities> ...
Example: ... fixtures-local/sizes size_20mb.dxf:150000 size_5mb.src.dxf:76000

Every entity sits on layer SIZES, which is defined in the LAYER table
(the first generation left it undefined, and the engine skipped every
entity with "layer 'SIZES' doesn't exist").
DWG files are made from R12 *.src.dxf output (DXFVER=R12) with LibreDWG
dxf2dwg: an R2000 source makes dxf2dwg write two *Model_Space block
headers, and the viewer then draws nothing.
"""
import math
import os
import sys

import ezdxf


def build(path, n):
    doc = ezdxf.new(os.environ.get("DXFVER", "R2000"))
    doc.layers.add("SIZES", color=3)
    msp = doc.modelspace()
    side = int(math.sqrt(n / 4)) + 1
    k = 0
    for i in range(side):
        for j in range(side):
            if k >= n:
                break
            x, y = i * 10.0, j * 10.0
            a = {"layer": "SIZES"}
            pts = [(x, y), (x + 6, y), (x + 6, y + 6), (x, y + 6)]
            if doc.dxfversion > "AC1009":
                msp.add_lwpolyline(pts, close=True, dxfattribs=a)
            else:  # R12 has no LWPOLYLINE and no BLOCK_RECORD table
                msp.add_polyline2d(pts, close=True, dxfattribs=a)
            msp.add_line((x, y), (x + 6, y + 6), dxfattribs=a)
            msp.add_circle((x + 3, y + 3), 2.5, dxfattribs=a)
            msp.add_text(f"{i}.{j}", height=1.2, dxfattribs={**a, "insert": (x + 0.5, y + 7)})
            k += 4
    doc.saveas(path)
    return k


def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for spec in sys.argv[2:]:
        name, n = spec.split(":")
        p = os.path.join(out, name)
        k = build(p, int(n))
        print(f"{name} entities={k} bytes={os.path.getsize(p)}")


if __name__ == "__main__":
    main()
