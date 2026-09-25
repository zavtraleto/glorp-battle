import * as THREE from 'three';
import { CHIPS, type ChipColor, type ChipId } from '../../data/chips';
import { drawBig, measureBig } from './cartFont';
import { drawText, measureText, type PixelSink } from '../crt/pixelFont';
import { CHIP_ICONS, ICON_PALETTE } from './chipIcons';

// Cartridge front (TERMINAL.md §6.1, reworked 2026-09-20): 60×74 texels that
// hold nothing but the coloured top panel and the label — no plastic border is
// drawn here, the body's own plastic frames the plane. The label runs the full
// width and carries the icon at ×3, so it takes as much of the front as it can
// (spec §6.1: no wide grey field).
//
// The plane is drawn with an unlit material, so the label stays light and the
// icon bright whatever the cabinet's lighting does. Small bevels and wear are
// painted here as one-texel edges — there is no normal map.

export const FACE_W = 60;
export const FACE_H = 74;
/** Bumped whenever the face design changes, so cached textures are not reused. */
const FACE_GEN = 8;

/**
 * Top panel colour per chip colour (GDD §6.1): dark enough for the light number
 * to read on it without an outline.
 */
export const CHIP_COLOR: Record<ChipColor, string> = {
  red: '#a3302a',
};

/** Label paper, also the colour of its shards (chipShards.ts). */
export const LABEL_COLOR = '#f4f1e6';

const COLOR = {
  /** Sunk edges: one texel of it above and left of each panel. */
  recess: '#2b2822',
  /** Worn plastic catching the light: one texel below and right. */
  lip: '#cfc8b8',
  label: LABEL_COLOR,
  labelWear: '#ded8c6',
  ink: '#fdfbf2',
};

/** Top panel and label, in texels. Together they fill the whole plane. */
const PANEL = { x: 0, y: 0, w: FACE_W, h: 20 };
const LABEL = { x: 0, y: 22, w: FACE_W, h: FACE_H - 22 };
/** Room the panel keeps for the number, in texels. */
export const PANEL_TEXT_W = FACE_W - 6;
const ICON_SCALE = 3;

const cache = new Map<string, THREE.CanvasTexture>();

/** Lit cooldown height in whole face texels, clamped to the full cartridge face. */
export function cooldownFaceRows(progress: number): number {
  return Math.floor(Math.max(0, Math.min(1, progress)) * FACE_H);
}

/** Cooling plastic brightness: much darker on arrival, normal at readiness. */
export function cooldownBodyLevel(progress: number): number {
  const p = Math.max(0, Math.min(1, progress));
  return 0.18 + p * 0.82;
}

/** One charge segment of the top panel, in texels. */
export interface ChargeSegment {
  x: number;
  w: number;
  lit: boolean;
}

/**
 * The top panel split into one segment per charge with a one-texel gap; spent
 * charges go dark from the right (GDD §6.1).
 */
export function chargeSegments(charges: number, max: number, width = FACE_W): ChargeSegment[] {
  const n = Math.max(1, Math.floor(max));
  const out: ChargeSegment[] = [];
  for (let i = 0; i < n; i++) {
    const x = Math.round((i * (width + 1)) / n);
    const end = Math.min(width, Math.round(((i + 1) * (width + 1)) / n) - 1);
    out.push({ x, w: end - x, lit: i < charges });
  }
  return out;
}

/** The number on the top panel: damage, or nothing. */
export function faceNumber(defId: ChipId): string {
  const power = CHIPS[defId].power;
  return power === null ? '' : String(power);
}

/** One texel of shadow along the top and left, one of lit plastic below and right. */
function sink(ctx: CanvasRenderingContext2D, r: { x: number; y: number; w: number; h: number }): void {
  ctx.fillStyle = COLOR.recess;
  ctx.fillRect(r.x, r.y, r.w, 1);
  ctx.fillRect(r.x, r.y, 1, r.h);
  ctx.fillStyle = COLOR.lip;
  ctx.fillRect(r.x, r.y + r.h - 1, r.w, 1);
  ctx.fillRect(r.x + r.w - 1, r.y, 1, r.h);
}

export function chipFaceTexture(defId: ChipId, charges: number, maxCharges: number): THREE.CanvasTexture {
  const key = `${defId}:${charges}/${maxCharges}:${FACE_GEN}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = FACE_W;
  canvas.height = FACE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const pixels = ctx as unknown as PixelSink;
  const def = CHIPS[defId];

  // Top panel: the chip's colour with the number left in a light ink — no
  // outline (decision 2026-09-20); letter codes are gone (2026-09-25). It is
  // cut into charge segments; spent ones show the sunk plastic.
  ctx.fillStyle = COLOR.recess;
  ctx.fillRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h);
  ctx.fillStyle = CHIP_COLOR[def.color];
  for (const seg of chargeSegments(charges, maxCharges, PANEL.w)) {
    if (seg.lit) ctx.fillRect(PANEL.x + seg.x, PANEL.y, seg.w, PANEL.h);
  }
  sink(ctx, PANEL);
  const number = faceNumber(defId);
  const textY = PANEL.y + 5;
  if (number) drawBig(pixels, number, PANEL.x + 3, textY, COLOR.ink);

  // The gap between the panel and the label is the plastic showing through.
  ctx.fillStyle = COLOR.recess;
  ctx.fillRect(0, PANEL.h, FACE_W, LABEL.y - PANEL.h);

  // Label: almost white, full width, with the icon taking most of it.
  ctx.fillStyle = COLOR.label;
  ctx.fillRect(LABEL.x, LABEL.y, LABEL.w, LABEL.h);
  // Worn corners, painted rather than modelled.
  ctx.fillStyle = COLOR.labelWear;
  ctx.fillRect(LABEL.x + 1, LABEL.y + LABEL.h - 3, 3, 2);
  ctx.fillRect(LABEL.x + LABEL.w - 4, LABEL.y + 1, 3, 2);
  sink(ctx, LABEL);

  const icon = CHIP_ICONS[defId];
  const size = icon.length * ICON_SCALE;
  const ix = LABEL.x + Math.round((LABEL.w - size) / 2);
  const iy = LABEL.y + Math.round((LABEL.h - size) / 2);
  icon.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = ICON_PALETTE[row[x] as string];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(ix + x * ICON_SCALE, iy + y * ICON_SCALE, ICON_SCALE, ICON_SCALE);
    }
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  cache.set(key, tex);
  return tex;
}

/** Back of the cartridge: one shared plastic marking, built on first use. */
let backTex: THREE.CanvasTexture | null = null;

export function cartridgeBackTexture(): THREE.CanvasTexture {
  if (backTex) return backTex;
  const canvas = document.createElement('canvas');
  canvas.width = FACE_W;
  canvas.height = FACE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.fillStyle = '#9b9489';
  ctx.fillRect(0, 0, FACE_W, FACE_H);
  // Moulded marking: the same plastic a shade darker, and no glow at all.
  const pixels = ctx as unknown as PixelSink;
  const name = 'NONAME';
  drawBig(pixels, name, Math.round((FACE_W - measureBig(name)) / 2), 24, '#7d776c');
  const sub = 'GAME MEDIA';
  drawText(pixels, sub, Math.round((FACE_W - measureText(sub)) / 2), 38, 1, '#7d776c');
  // Four screw bosses and the insertion arrow, as flat texels.
  for (const [sx, sy] of [
    [5, 5],
    [FACE_W - 11, 5],
    [5, FACE_H - 11],
    [FACE_W - 11, FACE_H - 11],
  ] as const) {
    ctx.fillStyle = '#8d887c';
    ctx.fillRect(sx, sy, 6, 6);
    ctx.fillStyle = '#6f6a60';
    ctx.fillRect(sx + 2, sy + 2, 2, 2);
  }
  ctx.fillStyle = '#7d776c';
  for (let i = 0; i < 5; i++) ctx.fillRect(FACE_W / 2 - 5 + i, 50 + i, 10 - i * 2, 1);
  backTex = new THREE.CanvasTexture(canvas);
  backTex.colorSpace = THREE.SRGBColorSpace;
  backTex.minFilter = THREE.NearestFilter;
  backTex.magFilter = THREE.NearestFilter;
  backTex.generateMipmaps = false;
  return backTex;
}
