export const VERSION_CODES = {
  AC1006: 'R10',
  AC1009: 'R11/R12',
  AC1012: 'R13',
  AC1014: 'R14',
  AC1015: '2000',
  AC1018: '2004',
  AC1021: '2007',
  AC1024: '2010',
  AC1027: '2013',
  AC1032: '2018',
};

// Placeholders until the 4.2.1 corpus run settles the real range.
export const SUPPORTED_RANGE = { oldest: 'AC1014', newest: 'AC1032' };

const BINARY_DXF_SENTINEL = 'AutoCAD Binary DXF\r\n\x1a\x00';

function isSupported(code) {
  return code >= SUPPORTED_RANGE.oldest && code <= SUPPORTED_RANGE.newest;
}

export function dwgVersion(bytes) {
  if (!bytes || bytes.length < 6) return null;
  const code = String.fromCharCode(...bytes.subarray(0, 6));
  if (!/^AC10\d\d$/.test(code)) return null;
  return { code, name: VERSION_CODES[code] ?? code, supported: isSupported(code) };
}

export function dxfVersion(bytes) {
  if (!bytes || bytes.length < 6) return null;
  let text;
  if (bytes.length >= 22) {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 22));
    if (head === BINARY_DXF_SENTINEL) {
      if (bytes.length < 28) return null;
      text = new TextDecoder('latin1').decode(bytes.subarray(22, 28));
      if (/^AC10\d\d$/.test(text)) return { code: text, name: VERSION_CODES[text] ?? text, supported: isSupported(text) };
      return { code: null, name: null, supported: true };
    }
  }
  text = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
  const m = text.match(/^\s*2\s*\$ACADVER\s*1\s*(AC10\d\d)/m);
  if (!m) return { code: null, name: null, supported: true };
  const code = m[1];
  return { code, name: VERSION_CODES[code] ?? code, supported: isSupported(code) };
}

export function sniffKind(bytes, fileName = '') {
  if (bytes && bytes.length >= 6 && dwgVersion(bytes)) return 'dwg';
  if (bytes && bytes.length >= 2 && bytes[0] === 0x30) return 'dxf';
  if (bytes && bytes.length >= 22) {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 22));
    if (head === BINARY_DXF_SENTINEL) return 'dxf';
  }
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.dwg')) return 'dwg';
  if (lower.endsWith('.dxf')) return 'dxf';
  return null;
}
