#!/usr/bin/env python3
# Size-tier corpus for ТЗ 4.2.4 (and 4.2.9 via the link flow): ASCII DXF files
# calibrated to ~1/5/20/50 MB, then converted to DWG r2000 by LibreDWG
# dxf2dwg. Marked "синтетический, LibreDWG" in the corpus table — not counted
# toward the ≥20 real DWG.
import subprocess
import sys
from pathlib import Path

import ezdxf

OUT = Path(__file__).resolve().parent.parent / "fixtures-local" / "sizes"
DXF2DWG = Path.home() / "claude/dwg viewer/_sync-hold/libredwg-0.14/programs/dxf2dwg"

TARGETS_MB = [1, 5, 20, 50]


def build(path: Path, target_mb: int) -> None:
    doc = ezdxf.new("R2000", setup=False)
    doc.header["$ACADVER"] = "AC1015"
    msp = doc.modelspace()
    n = 0
    # ~2.7 bytes per entity byte-wise is unknowable up front: grow in chunks
    # until the serialized file crosses the target. Re-serialize is cheap
    # relative to conversion.
    chunk = 2000
    while True:
        for _ in range(chunk):
            k = n % 4
            if k == 0:
                msp.add_lwpolyline(
                    [(i * 1.7, i * 2.3 - i * i * 0.01) for i in range(6)],
                    format="xy",
                    close=True,
                    dxfattribs={"layer": "SIZES"},
                )
            elif k == 1:
                msp.add_line((n, 0), (n + 30, 42), dxfattribs={"layer": "SIZES"})
            elif k == 2:
                msp.add_circle((n % 990, n % 770), radius=12.5, dxfattribs={"layer": "SIZES"})
            else:
                msp.add_text(
                    f"P{n}",
                    dxfattribs={"layer": "SIZES", "height": 2.5},
                ).set_placement((n % 900, n % 600))
            n += 1
        doc.saveas(path)
        size = path.stat().st_size
        print(f"  {path.name}: {n} entities, {size/1048576:.1f} MB", flush=True)
        if size >= target_mb * 1048576:
            return


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for mb in TARGETS_MB:
        dxf = OUT / f"size_{mb}mb.dxf"
        dwg = OUT / f"size_{mb}mb.dwg"
        if not dxf.exists():
            print(f"building {dxf.name} (~{mb} MB)", flush=True)
            build(dxf, mb)
        if dxf.exists() and not dwg.exists():
            r = subprocess.run(
                [str(DXF2DWG), "--as", "r2000", "-o", str(dwg), str(dxf)],
                capture_output=True,
                text=True,
                timeout=3600,
            )
            if r.returncode != 0 or not dwg.exists():
                print(f"FAIL dxf2dwg {dxf.name}: {r.stderr[-300:]}", file=sys.stderr)
                return 1
            print(f"  -> {dwg.name}: {dwg.stat().st_size/1048576:.1f} MB", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
