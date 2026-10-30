// Light-canvas colour mapping (ТЗ F-11 / F-15, дизайн 5.6): on the Light
// background (and on the printed sheet, which is always light) every line
// keeps its hue but is darkened until its contrast against the background is
// at least 4.5:1. Dark background: colours are used as the file has them.
// The mapping is idempotent — an already-mapped colour is returned unchanged —
// so walking the same materials twice (screen toggle → print → back) is safe.
import ACI_RGB from './aci-rgb.json' with { type: 'json' };

// oklch(99.3% 0 0) from ТЗ 5.6, as 24-bit RGB.
export const LIGHT_BACKGROUND_RGB = 0xfdfdfd;

// Contrast per WCAG relative luminance (ТЗ 6.5 uses the same 4.5:1 bar).
function srgbToLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
export function relativeLuminance(rgb) {
  const r = srgbToLinear((rgb >> 16) & 255);
  const g = srgbToLinear((rgb >> 8) & 255);
  const b = srgbToLinear(rgb & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/* ---------- sRGB <-> OKLCH (no dependencies) ---------- */

function linearToSrgb(c) {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(1, v)) * 255);
}
export function rgbToOklch(rgb) {
  const r = srgbToLinear((rgb >> 16) & 255);
  const g = srgbToLinear((rgb >> 8) & 255);
  const b = srgbToLinear(rgb & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B), H: Math.atan2(B, A) };
}
export function oklchToRgb({ L, C, H }) {
  const A = C * Math.cos(H);
  const B = C * Math.sin(H);
  const l = L + 0.3963377774 * A + 0.2158037573 * B;
  const m = L - 0.1055613458 * A - 0.0638541728 * B;
  const s = L - 0.0894841775 * A - 1.291485548 * B;
  const lr = l * l * l;
  const mg = m * m * m;
  const sb = s * s * s;
  return (
    (linearToSrgb(4.0767416621 * lr - 3.3077115913 * mg + 0.2309699292 * sb) << 16) |
    (linearToSrgb(-1.2684380046 * lr + 2.6097574011 * mg - 0.3413193965 * sb) << 8) |
    linearToSrgb(-0.0041960863 * lr - 0.7034186147 * mg + 1.707614701 * sb)
  );
}

/**
 * Darkens one RGB colour just enough to reach `target` contrast against
 * `background`, keeping hue and chroma. Colours that already pass return
 * unchanged (idempotence), so already-dark file colours are never shifted.
 */
export function darkenToContrast(rgb, background = LIGHT_BACKGROUND_RGB, target = 4.5) {
  if (contrastRatio(rgb, background) >= target) return rgb;
  const { L: startL, C, H } = rgbToOklch(rgb);
  // Invariant: `lo` fails the bar (starts at the source lightness), `hi`
  // passes it (black always does). Converges on the brightest passing L.
  let lo = startL;
  let hi = 0;
  for (let i = 0; i < 24 && lo - hi > 1e-4; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(oklchToRgb({ L: mid, C, H }), background) >= target) hi = mid;
    else lo = mid;
  }
  return oklchToRgb({ L: hi, C, H });
}

/** ТЗ 5.6: the whole ACI palette must clear 4.5:1 after the mapping. */
export function aciMappedContrastOk(background = LIGHT_BACKGROUND_RGB) {
  for (let i = 1; i <= 255; i++) {
    const rgb = ACI_RGB[i];
    if (contrastRatio(darkenToContrast(rgb, background), background) < 4.5) return i;
  }
  return 0;
}

/** Runtime hook used by the vendored engine (see tools/vendor-patch-colors.js). */
export function setEngineColorMapper(fn) {
  globalThis.__dwgColorMap = fn;
}
