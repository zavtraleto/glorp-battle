import type { ChipCode } from '../../data/chips';

// Colour of a chip's code letter (spec §9.1). Codes decide which chips can be
// selected together, so the letter carries a colour of its own and matching
// codes are spotted across the tray without reading them.

/** Wildcard: neutral steel, deliberately outside the letter hues. */
const WILDCARD = '#d8d8d8';
/** Fixed saturation and lightness keep every letter legible on the dark plaque. */
const SAT = 0.62;
const LIGHT = 0.62;

function hex(n: number): string {
  return Math.round(Math.max(0, Math.min(1, n)) * 255)
    .toString(16)
    .padStart(2, '0');
}

/** HSL → #rrggbb. */
function hsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;
  const rgb: [number, number, number] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return `#${hex(rgb[0] + m)}${hex(rgb[1] + m)}${hex(rgb[2] + m)}`;
}

export function codeColor(code: ChipCode): string {
  if (code === '*') return WILDCARD;
  const i = code.charCodeAt(0) - 65;
  // Spread neighbouring letters far apart in hue so A and B never read alike.
  return hsl(((i * 9) % 26) * (360 / 26), SAT, LIGHT);
}
