import * as THREE from 'three';

// "Dark Terminal" palette (spec §6.1). The battle scene is drawn with unlit
// "signal" colours — red channel carries the palette index, green the
// brightness — and the palette pass turns every pixel into one of six flat
// colours, using a 4×4 Bayer threshold for partial brightness.

export const PALETTE = {
  bg: 0x05070a,
  phosphor: 0x3cffd2,
  red: 0xff2a3a,
  accent: 0xffd45e,
  blue: 0x4a7cff,
  purple: 0xb05cff,
} as const;

export type Role = 'phosphor' | 'red' | 'accent' | 'blue' | 'purple';

/** Palette index: 0 background, then one per role. */
export type PaletteIndex = 0 | 1 | 2 | 3 | 4 | 5;

export const ROLE_INDEX: Record<Role, PaletteIndex> = {
  phosphor: 1,
  red: 2,
  accent: 3,
  blue: 4,
  purple: 5,
};

/** Palette colours by index; the pass uploads this as a uniform array. */
export const PALETTE_COLORS: readonly number[] = [
  PALETTE.bg,
  PALETTE.phosphor,
  PALETTE.red,
  PALETTE.accent,
  PALETTE.blue,
  PALETTE.purple,
];

/**
 * Unlit scene colour for a role at a brightness (0..1): index in red,
 * brightness in green. The index survives the 8-bit target exactly.
 */
export function signal(role: Role, intensity = 1, out = new THREE.Color()): THREE.Color {
  const v = Math.max(0, Math.min(1, intensity));
  return out.setRGB(ROLE_INDEX[role] / 255, v, 0, THREE.LinearSRGBColorSpace);
}

/**
 * Scales a signal's brightness, keeping its palette index. Scaling the colour
 * itself would scale the index out of the red channel and repaint the pixel.
 */
export function dimSignal(src: THREE.Color, k: number, out = new THREE.Color()): THREE.Color {
  return out.setRGB(src.r, Math.max(0, Math.min(1, src.g * k)), 0, THREE.LinearSRGBColorSpace);
}

function fract(v: number): number {
  return v - Math.floor(v);
}

function bayer2(x: number, y: number): number {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  return fract(fx / 2 + fy * fy * 0.75);
}

/** 4×4 ordered-dither threshold in [0, 1) — mirrors the palette shader. */
export function bayer4(x: number, y: number): number {
  return bayer2(x * 0.5, y * 0.5) * 0.25 + bayer2(x, y);
}

/** Half a Bayer step: full brightness always passes, zero never does. */
export const DITHER_BIAS = 1 / 32;

/** JS mirror of the palette pass for one pixel. */
export function paletteIndex(r: number, g: number, b: number, x: number, y: number): PaletteIndex {
  void b;
  const index = Math.round(r * 255);
  if (index <= 0 || index >= PALETTE_COLORS.length) return 0;
  return g > bayer4(x, y) + DITHER_BIAS ? (index as PaletteIndex) : 0;
}

export const PALETTE_GLSL = /* glsl */ `
float bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x / 2.0 + a.y * a.y * 0.75);
}
float bayer4(vec2 a) {
  return bayer2(0.5 * a) * 0.25 + bayer2(a);
}
`;
