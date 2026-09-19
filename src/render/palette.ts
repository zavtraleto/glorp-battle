import * as THREE from 'three';

// "Dark Terminal" palette (spec §6.1). The battle scene is drawn with unlit
// "signal" colours — red channel carries the palette index, green the
// brightness — and the palette pass turns every pixel into its palette colour,
// dimmed toward the background by the brightness. No dithering (2026-09-19).

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

/** Palette index a signal pixel resolves to; 0 (background) when dark or unknown. */
export function paletteIndex(r: number, g: number): PaletteIndex {
  const index = Math.round(r * 255);
  if (index <= 0 || index >= PALETTE_COLORS.length || g <= 0) return 0;
  return index as PaletteIndex;
}

/** JS mirror of the palette pass for one pixel: the colour, mixed from the background by brightness. */
export function paletteColor(r: number, g: number, out = new THREE.Color()): THREE.Color {
  const bg = new THREE.Color(PALETTE_COLORS[0]);
  const index = paletteIndex(r, 1);
  if (index === 0) return out.copy(bg);
  return out.copy(bg).lerp(new THREE.Color(PALETTE_COLORS[index]), Math.max(0, Math.min(1, g)));
}
