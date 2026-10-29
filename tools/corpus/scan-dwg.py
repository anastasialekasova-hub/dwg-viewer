"""Independent reference count for the Э1 corpus (ТЗ 4.2.1, 4.2.3).

For each DWG: version (first 6 bytes), writing program (AppInfo / SummaryInfo
strings), and top-level entities in model + paper space by type and layer,
read with LibreDWG dwgread -O json (entmode 2 = model, 1 = paper space).
Output: one JSON object per file on stdout (JSONL).

  tools/.venv/bin/python -I tools/corpus/scan-dwg.py <dwgread> <file.dwg>...
"""
import json, os, re, subprocess, sys, tempfile
from collections import Counter, defaultdict


def utf16_strings(hexstr):
    try:
        raw = bytes.fromhex(hexstr)
    except ValueError:
        return []
    out = []
    for m in re.finditer(rb'(?:[\x20-\x7e]\x00){4,}', raw):
        out.append(m.group().decode('utf-16le'))
    return out


def handle_of(ref):
    # dwgread json refs look like [code, size, value, absolute]
    if isinstance(ref, list) and ref:
        return ref[-1]
    return ref


def scan(dwgread, path):
    rec = {'file': path, 'version': open(path, 'rb').read(6).decode('latin1'), 'bytes': os.path.getsize(path)}
    with tempfile.TemporaryDirectory() as td:
        out = os.path.join(td, 'o.json')
        p = subprocess.run([dwgread, '-O', 'json', '-o', out, path], capture_output=True, timeout=600)
        rec['dwgread_rc'] = p.returncode
        if not os.path.exists(out):
            rec['error'] = p.stderr.decode('latin1')[-300:]
            return rec
        try:
            d = json.load(open(out, encoding='utf-8', errors='replace'))
        except Exception as e:  # malformed json from dwgread
            rec['error'] = 'json: %s' % e
            return rec
    app = []
    for key in ('AppInfo', 'AppInfoHistory'):
        sec = d.get(key) or {}
        for k, v in sec.items():
            if isinstance(v, str) and re.fullmatch(r'[0-9A-Fa-f]{16,}', v):
                app += utf16_strings(v)
            elif isinstance(v, str) and v.strip():
                app.append(v)
    si = d.get('SummaryInfo') or {}
    rec['app'] = [s for s in app if len(s) > 3][:8]
    rec['summary'] = {k: v for k, v in si.items() if isinstance(v, str) and v.strip()}
    objs = d.get('OBJECTS', [])
    layers = {}
    for o in objs:
        if o.get('object') == 'LAYER':
            layers[o.get('handle', [None, None])[-1] if isinstance(o.get('handle'), list) else o.get('handle')] = o.get('name')
    by_type = Counter()
    by_type_layer = defaultdict(Counter)
    for o in objs:
        t = o.get('entity')
        if not t:
            continue
        if o.get('entmode') not in (1, 2):
            continue
        by_type[t] += 1
        lay = layers.get(handle_of(o.get('layer')), str(handle_of(o.get('layer'))))
        by_type_layer[t][lay] += 1
    rec['total'] = sum(by_type.values())
    rec['by_type'] = dict(by_type.most_common())
    rec['by_type_layer'] = {t: dict(c) for t, c in by_type_layer.items()}
    rec['all_entities'] = sum(1 for o in objs if o.get('entity'))
    return rec


if __name__ == '__main__':
    exe = sys.argv[1]
    for f in sys.argv[2:]:
        try:
            print(json.dumps(scan(exe, f), ensure_ascii=False), flush=True)
        except subprocess.TimeoutExpired:
            print(json.dumps({'file': f, 'error': 'dwgread timeout 600s'}), flush=True)
