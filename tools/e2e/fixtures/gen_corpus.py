#!/usr/bin/env python3
"""Generates the Э1 corpus (ТЗ 4.2.1 / 4.2.2): DXF natively via ezdxf.

Every file is generated here, so the drawings are ours (no third-party
content, no license constraints). DWG variants are produced from these
DXFs by LibreDWG dwgwrite — see convert_dwg.sh.

Covers per file (showcase a/b): SPLINE, HATCH solid + pattern, TEXT/MTEXT,
linear/aligned/radius/diameter DIMENSION, 2-level nested INSERT,
LWPOLYLINE with bulge, ELLIPSE, Model + Layout1.

Usage: tools/.venv/bin/python3 tools/e2e/fixtures/gen_corpus.py [--big-only]
"""
import io
import math
import os
import sys

import ezdxf

HERE = os.path.dirname(os.path.abspath(__file__))
DXF_DIR = os.path.join(HERE, 'dxf')

EZ_VER = {
    'r14': ('R14', 'AC1014'),
    'r2000': ('R2000', 'AC1015'),
    '2000': ('R2000', 'AC1015'),
    '2004': ('R2004', 'AC1018'),
    '2007': ('R2007', 'AC1021'),
    '2010': ('R2010', 'AC1024'),
    '2013': ('R2013', 'AC1027'),
    '2018': ('R2018', 'AC1032'),
    'r12': ('R12', 'AC1009'),
}


def new_doc(vkey):
    ez, _ = EZ_VER[vkey]
    doc = ezdxf.new(ez, setup=False)
    doc.header['$MEASUREMENT'] = 1
    return doc


def ensure_layout1(doc):
    if 'Layout1' not in doc.layouts:
        doc.layouts.new('Layout1')
    return doc.layouts.get('Layout1')


def title_block(lay, label):
    y = 0
    lay.add_lwpolyline([(0, 0), (297, 0), (297, 210), (0, 210)], close=True)
    lay.add_line((297, 30), (230, 30))
    lay.add_line((230, 30), (230, 0))
    lay.add_text(label, dxfattribs={'height': 6, 'insert': (238, 12)})
    lay.add_line((0, 105), (297, 105))


def blocks(doc):
    washer = doc.blocks.new(name='WASHER')
    washer.add_circle((0, 0), 3)
    washer.add_circle((0, 0), 1.4)
    bolt = doc.blocks.new(name='BOLT_ASSEMBLY')
    bolt.add_blockref('WASHER', (0, 0))          # nesting: msp -> BOLT -> WASHER
    bolt.add_lwpolyline([(-6, -6), (6, -6), (6, 6), (-6, 6)], close=True)
    bolt.add_line((-6, -6), (6, 6))
    bolt.add_line((-6, 6), (6, -6))


def showcase_a(doc):
    """Mechanical plate — all required entity types on Model, title block on Layout1."""
    msp = doc.modelspace()
    msp.add_lwpolyline([(0, 0), (120, 0), (120, 80), (0, 80)], close=True,
                       dxfattribs={'const_width': 0.4, 'color': 7})
    for cx, cy, r in [(20, 60, 6), (40, 60, 6), (60, 60, 6)]:
        msp.add_circle((cx, cy), r, dxfattribs={'color': 5})
    msp.add_arc((90, 60), 15, 20, 160, dxfattribs={'color': 5})
    msp.add_open_spline([(10, 20), (30, 10), (60, 25), (95, 15), (110, 30)],
                        degree=3, dxfattribs={'color': 1})
    msp.add_ellipse((30, 40), major_axis=(15, 0), ratio=0.5, dxfattribs={'color': 3})
    msp.add_ellipse((90, 30), major_axis=(12, 6), ratio=0.6,
                    start_param=0.3, end_param=3.5, dxfattribs={'color': 3})
    msp.add_lwpolyline([(15, 70, 0), (35, 70, 1.0), (55, 70, 0)], format='xyb',
                       dxfattribs={'color': 4})
    hatch = msp.add_hatch(color=3)
    hatch.paths.add_polyline_path([(80, 15), (100, 15), (100, 5), (80, 5)], is_closed=True)
    hatch.set_pattern_fill('SOLID')
    h2 = msp.add_hatch(color=2)
    h2.paths.add_polyline_path([(103, 45), (118, 45), (118, 75), (103, 75)], is_closed=True)
    h2.set_pattern_fill('ANSI31', scale=1.2)
    msp.add_text('PLATE A-01', dxfattribs={'height': 4, 'insert': (5, 3), 'color': 7})
    msp.add_mtext('Mech plate\nSPLINE/HATCH/DIM coverage',
                  dxfattribs={'char_height': 2.5, 'insert': (5, 73), 'color': 7})
    msp.add_linear_dim(base=(0, -8), p1=(0, 0), p2=(120, 0)).render()
    msp.add_aligned_dim(p1=(0, 80), p2=(120, 80), distance=8).render()
    msp.add_radius_dim(center=(20, 60), radius=6, angle=45).render()
    msp.add_diameter_dim(center=(40, 60), radius=6, angle=45).render()
    blocks(doc)
    msp.add_blockref('BOLT_ASSEMBLY', (100, 40))
    msp.add_blockref('BOLT_ASSEMBLY', (72, 40), dxfattribs={'rot': 15})
    title_block(ensure_layout1(doc), 'A-01 / Layout1')


def showcase_b(doc):
    """Site plan — bulge-heavy road, pond ellipse, grass hatch, building inserts."""
    msp = doc.modelspace()
    msp.add_lwpolyline(
        [(10, 10, 0), (60, 10, 0.6), (110, 40, 0), (110, 90, 0.6), (60, 110, 0)],
        format='xyb', dxfattribs={'const_width': 4, 'color': 8})
    msp.add_ellipse((150, 80), major_axis=(25, 8), ratio=0.55, dxfattribs={'color': 4})
    grass = msp.add_hatch(color=3)
    grass.paths.add_polyline_path([(20, 40), (60, 40), (60, 70), (20, 70)], is_closed=True)
    grass.set_pattern_fill('GRASS', scale=2)
    house = doc.blocks.new(name='HOUSE')
    house.add_lwpolyline([(0, 0), (24, 0), (24, 14), (0, 14)], close=True)
    house.add_line((0, 14), (12, 22))
    house.add_line((12, 22), (24, 14))
    house.add_blockref('WASHER', (12, 7))
    msp.add_blockref('HOUSE', (140, 20))
    msp.add_blockref('HOUSE', (185, 20), dxfattribs={'rot': 90})
    msp.add_blockref('HOUSE', (140, 120), dxfattribs={'xscale': 1.5, 'yscale': 1.5})
    msp.add_text('SITE PLAN B', dxfattribs={'height': 6, 'insert': (10, 130)})
    msp.add_mtext('Pond / road bulge / building blocks', dxfattribs={
        'char_height': 3, 'insert': (130, 130)})
    msp.add_linear_dim(base=(140, -6), p1=(140, 20), p2=(185, 20), angle=0).render()
    msp.add_radius_dim(center=(150, 80), mpoint=(175, 88), angle=20).render()
    blocks(doc)
    msp.add_blockref('BOLT_ASSEMBLY', (60, 55))
    title_block(ensure_layout1(doc), 'B-02 / Layout1')


def dialect_qcad(doc):
    """QCAD-flavored R2000: TEXT only (no MTEXT), uppercase layers, plain dims."""
    doc.layers.add(name='OUTLINE', color=7)
    doc.layers.add(name='CENTER', color=1, linetype='CENTER')
    msp = doc.modelspace()
    msp.add_lwpolyline([(0, 0), (100, 0), (100, 60), (0, 60)], close=True,
                       dxfattribs={'layer': 'OUTLINE'})
    msp.add_circle((50, 30), 20, dxfattribs={'layer': 'CENTER'})
    msp.add_line((20, 30), (80, 30), dxfattribs={'layer': 'CENTER'})
    msp.add_text('QCAD DIALECT', dxfattribs={'height': 5, 'insert': (5, 65)})
    msp.add_linear_dim(base=(0, -8), p1=(0, 0), p2=(100, 0)).render()
    title_block(ensure_layout1(doc), 'QCAD / Layout1')


def dialect_librecad(doc):
    """LibreCAD-flavored R14: flat geometry, dashed border, no blocks."""
    msp = doc.modelspace()
    msp.add_lwpolyline([(0, 0), (80, 0), (80, 55), (0, 55)], close=True)
    for i in range(4):
        msp.add_circle((15 + i * 18, 28), 6, dxfattribs={'color': 4})
    msp.add_text('LIBRECAD DIALECT', dxfattribs={'height': 4, 'insert': (5, 60)})
    msp.add_aligned_dim(p1=(0, 55), p2=(80, 55), distance=6).render()


def dialect_inkscape(doc):
    """Inkscape-flavored R14: curves flattened to short LINE segments, no dims."""
    msp = doc.modelspace()
    pts = [(50 + 40 * math.cos(a), 30 + 25 * math.sin(a))
           for a in [i * 2 * math.pi / 48 for i in range(48)]]
    msp.add_lwpolyline(pts, close=True)
    msp.add_lwpolyline([(0, 0), (100, 0), (100, 60), (0, 60)], close=True)
    msp.add_text('INKSCAPE DIALECT (flattened)', dxfattribs={'height': 4, 'insert': (5, 65)})


def dialect_cam(doc):
    """CAM-flavored R2000: closed kerf contours, tool labels, no layouts."""
    msp = doc.modelspace()
    part = doc.blocks.new(name='PART_NEST')
    part.add_lwpolyline([(0, 0), (40, 0), (40, 20), (0, 20)], close=True)
    part.add_circle((10, 10), 3)
    part.add_circle((30, 10), 3)
    msp.add_blockref('PART_NEST', (0, 0))
    msp.add_blockref('PART_NEST', (45, 0))
    msp.add_blockref('PART_NEST', (0, 25))
    msp.add_text('SHEET 500x300  KERF 0.2', dxfattribs={'height': 5, 'insert': (0, 55)})


def stress_grid(doc, cols=400, rows=200):
    msp = doc.modelspace()
    for r in range(rows):
        msp.add_line((0, r * 2), (cols * 2, r * 2), dxfattribs={'color': 8})
    for c in range(cols):
        msp.add_line((c * 2, 0), (c * 2, rows * 2), dxfattribs={'color': 8})


def stress_nested_deep(doc):
    """4-level insert tree A->B->C->D, 16 leaf instances."""
    msp = doc.modelspace()
    d = doc.blocks.new(name='LEAF_D')
    d.add_circle((0, 0), 4)
    d.add_line((-4, -4), (4, 4))
    c = doc.blocks.new(name='MID_C')
    for dx, dy in [(0, 0), (20, 0), (0, 20), (20, 20)]:
        c.add_blockref('LEAF_D', (dx, dy))
    b = doc.blocks.new(name='MID_B')
    for rot in (0, 30, 60, 90):
        b.add_blockref('MID_C', (0, 0), dxfattribs={'rot': rot})
    a = doc.blocks.new(name='TOP_A')
    a.add_blockref('MID_B', (0, 0))
    a.add_lwpolyline([(-30, -30), (50, -30), (50, 50), (-30, 50)], close=True)
    msp.add_blockref('TOP_A', (0, 0))
    msp.add_text('4-LEVEL NESTING', dxfattribs={'height': 6, 'insert': (-30, 60)})


def stress_bulge(doc):
    msp = doc.modelspace()
    pts = []
    for i in range(600):
        pts.append((i * 0.5, 10 * math.sin(i / 12.0), 0.4 if i % 2 else 0))
    msp.add_lwpolyline(pts, format='xyb', dxfattribs={'color': 5})


def big_file(doc, target_lines):
    msp = doc.modelspace()
    n = 0
    y = 0
    while n < target_lines:
        msp.add_lwpolyline([(0, y), (1000, y), (1000, y + 1), (0, y + 1)],
                           close=True, dxfattribs={'color': (n % 256) + 1})
        y += 2
        n += 1
    msp.add_text('BIG', dxfattribs={'height': 20, 'insert': (0, y + 10)})


def save(doc, name, binary=False):
    path = os.path.join(DXF_DIR, name)
    if binary:
        with open(path, 'wb') as fp:
            doc.write(fp, fmt='bin')
    else:
        doc.saveas(path)
    if name == 'dxf-nover-2010.dxf':
        strip_acadver(path)
    size = os.path.getsize(path)
    print(f'{name}  {size} bytes')
    return path


def strip_acadver(path):
    with open(path, 'r', encoding='ascii', errors='replace') as fp:
        lines = fp.readlines()
    out, skip = [], 0
    for i, ln in enumerate(lines):
        if skip:
            skip -= 1
            continue
        if ln.strip() == '$ACADVER':
            skip = 2  # value group code + value line
            continue
        out.append(ln)
    with open(path, 'w', encoding='ascii', errors='replace') as fp:
        fp.writelines(out)


def main():
    os.makedirs(DXF_DIR, exist_ok=True)
    big_only = '--big-only' in sys.argv

    if not big_only:
        # R14 is not creatable by ezdxf -> staged as R2000 content; convert_dwg.sh
        # downgrades it with `dwgwrite --as r14` and produces the R14 DXF back via
        # `dwg2dxf`. 2007 DWG is not writable by LibreDWG at all -> ODA on the
        # test server produces those two.
        for vkey in ('r14', '2000', '2004', '2007', '2010', '2013', '2018'):
            src = 'r2000' if vkey == 'r14' else vkey
            for tag, build in (('a', showcase_a), ('b', showcase_b)):
                save(new_doc(src) | _Apply(build), f'src-dwg-{vkey}-{tag}.dxf')
        save(new_doc('2018') | _Apply(showcase_a), 'dxf-autocad-2018-a.dxf')
        save(new_doc('2013') | _Apply(showcase_b), 'dxf-autocad-2013-b.dxf')
        save(new_doc('2004') | _Apply(showcase_a), 'dxf-autocad-2004-a.dxf')
        save(new_doc('2000') | _Apply(showcase_b), 'dxf-autocad-2000-b.dxf')
        save(new_doc('2018') | _Apply(showcase_a), 'dxf-binary-2018-a.dxf', binary=True)
        save(new_doc('2004') | _Apply(showcase_b), 'dxf-binary-2004-b.dxf', binary=True)
        save(new_doc('2000') | _Apply(dialect_qcad), 'dxf-qcad-2000-a.dxf')
        save(new_doc('r2000') | _Apply(dialect_librecad), 'dxf-librecad-2000-a.dxf')
        save(new_doc('r2000') | _Apply(dialect_inkscape), 'dxf-inkscape-2000-a.dxf')
        save(new_doc('2000') | _Apply(dialect_cam), 'dxf-cam-2000-a.dxf')
        save(new_doc('r12') | _Apply(dialect_librecad), 'dxf-r12-unsupported.dxf')
        save(new_doc('2010') | _Apply(showcase_b), 'dxf-nover-2010.dxf')
        save(new_doc('2018') | _Apply(stress_grid), 'dwg-stress-grid.dxf')
        save(new_doc('2018') | _Apply(stress_nested_deep), 'dwg-stress-nested.dxf')
        save(new_doc('2018') | _Apply(stress_bulge), 'dwg-stress-bulge.dxf')

    for mb, lines in (('1m', 1200), ('5m', 6500), ('20m', 26000), ('50m', 65000)):
        save(new_doc('2018') | _Apply(big_file, lines), f'dwg-big-{mb}.dxf')


class _Apply:
    """new_doc(v) | _Apply(fn, *args) — just a readable builder call."""
    def __init__(self, fn, *args):
        self.fn, self.args = fn, args
    def __ror__(self, doc):
        self.fn(doc, *self.args)
        return doc


if __name__ == '__main__':
    main()
