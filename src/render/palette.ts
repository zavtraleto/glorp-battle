import * as THREE from 'three';

// "CRT Occult Vector" palette (BATTLE_VISUAL.md §1). The battle scene is drawn
// with unlit "signal" colours — one channel per role, value = brightness — and
// the palette pass turns every pixel into one of four flat colours, using a
// 4×4 Bayer threshold for partial brightness.

export const PALETTE = {
  bg: 0x05070a,
  phosphor: 0x3cffd2,
  red: 0xff2a3a,
  accent: 0xfff4c2,
} as const;

export type Role = 'phosphor' | 'red' | 'accent';

/** Palette index: 0 background, 1 phosphor, 2 red, 3 accent. */
export type PaletteIndex = 0 | 1 | 2 | 3;

/** Unlit scene colour for a role at a brightness (0..1). */
export function signal(role: Role, intensity = 1, out = new THREE.Color()): THREE.Color {
  const v = Math.max(0, Math.min(1, intensity));
  if (role === 'phosphor') return out.setRGB(0, v, 0, THREE.LinearSRGBColorSpace);
  if (role === 'red') return out.setRGB(v, 0, 0, THREE.LinearSRGBColorSpace);
  return out.setRGB(0, 0, v, THREE.LinearSRGBColorSpace);
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
  let v: number;
  let index: PaletteIndex;
  if (b >= r && b >= g) {
    v = b;
    index = 3;
  } else if (r >= g) {
    v = r;
    index = 2;
  } else {
    v = g;
    index = 1;
  }
  return v > bayer4(x, y) + DITHER_BIAS ? index : 0;
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
