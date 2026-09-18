import { tuning } from '../../config/tuning';
import { rectContains, type Rect, type TerminalLayout } from '../layout';

// Geometry of the chip rail slots and the chip tray (TERMINAL.md §6.4), in CSS px. Pure.

export const RAIL_SLOTS = 5;
/** Slots span this share of the rail width, starting RAIL_LEFT (share of width) left of its centre. */
export const RAIL_SPAN = 0.82;
export const RAIL_LEFT = 0.475;
/** Cartridge size in texels (face 64×88 plus the body rim). */
export const CHIP_TEXELS_W = 68;
export const CHIP_TEXELS_H = 94;
const TRAY_COLS = 5;
/** Bottom share of the deck used by the OK / ADD keys. */
const KEYS_SHARE = 0.27;
/** The keys never go below a comfortable touch target, CSS px. */
const MIN_KEY_H = 64;
/** A drop this far outside the slot row (share of the rail height) still counts. */
const DROP_PAD = 0.35;

export function railSlotRects(layout: TerminalLayout): Rect[] {
  const r = layout.rail;
  const pitch = (r.w * RAIL_SPAN) / RAIL_SLOTS;
  const x0 = r.x + r.w / 2 - r.w * RAIL_LEFT;
  return Array.from({ length: RAIL_SLOTS }, (_, i) => ({ x: x0 + pitch * i, y: r.y, w: pitch, h: r.h }));
}

/**
 * Selection index for a chip dropped at (x, y), or null when it misses the rail.
 * Dropping past the last selected chip appends (the rail stays packed).
 */
export function railDropIndex(layout: TerminalLayout, x: number, y: number, selected: number): number | null {
  const slots = railSlotRects(layout);
  const first = slots[0] as Rect;
  const last = slots[slots.length - 1] as Rect;
  const pad = layout.rail.h * DROP_PAD;
  const band: Rect = { x: first.x - pad, y: first.y - pad, w: last.x + last.w - first.x + 2 * pad, h: first.h + 2 * pad };
  if (!rectContains(band, x, y)) return null;
  const i = Math.max(0, Math.min(RAIL_SLOTS - 1, Math.floor((x - first.x) / first.w)));
  return Math.min(i, selected);
}

/** Rail slot under the pointer (for pulling chips out), or null. */
export function railSlotAt(layout: TerminalLayout, x: number, y: number): number | null {
  const i = railSlotRects(layout).findIndex((r) => rectContains(r, x, y));
  return i < 0 ? null : i;
}

export interface TrayLayout {
  cells: Rect[];
  ok: Rect;
  add: Rect;
  /** Cartridge scale on the tray (1 = rail size). */
  scale: number;
}

/** CSS px per texel: the body's short side spans RENDER_SCALE_SHORT texels. */
export function cssPerTexel(layout: TerminalLayout): number {
  return Math.min(layout.body.w, layout.body.h) / tuning.terminal.RENDER_SCALE_SHORT;
}

export function trayLayout(layout: TerminalLayout, handSize: number): TrayLayout {
  const d = layout.deck;
  // The deck is only 23% of the body now, so the keys claim their touch size
  // first and the hand grid takes what is left (the cartridges scale down).
  const keysH = Math.max(d.h * KEYS_SHARE, MIN_KEY_H);
  const gridH = d.h - keysH;
  const rows = Math.max(1, Math.ceil(handSize / TRAY_COLS));
  const gridW = d.w * 0.92;
  const cellW = gridW / TRAY_COLS;
  const cellH = gridH / rows;
  const gx = d.x + (d.w - gridW) / 2;
  const cells: Rect[] = [];
  for (let i = 0; i < handSize; i++) {
    cells.push({ x: gx + (i % TRAY_COLS) * cellW, y: d.y + Math.floor(i / TRAY_COLS) * cellH, w: cellW, h: cellH });
  }
  const px = cssPerTexel(layout);
  const scale = Math.min(1, (cellW * 0.92) / (CHIP_TEXELS_W * px), (cellH * 0.9) / (CHIP_TEXELS_H * px));
  const keyY = d.y + gridH;
  const keyH = keysH * 0.9;
  return {
    cells,
    add: { x: d.x + d.w * 0.06, y: keyY, w: d.w * 0.3, h: keyH },
    ok: { x: d.x + d.w * 0.46, y: keyY, w: d.w * 0.48, h: keyH },
    scale,
  };
}

export type TrayTarget = { kind: 'hand'; slot: number } | { kind: 'ok' } | { kind: 'add' } | { kind: 'rail'; index: number };

/** What a press on the tray screen hits. `selected` = number of chips in the rail. */
export function trayTargetAt(layout: TerminalLayout, tray: TrayLayout, x: number, y: number, selected: number): TrayTarget | null {
  if (rectContains(tray.ok, x, y)) return { kind: 'ok' };
  if (rectContains(tray.add, x, y)) return { kind: 'add' };
  const cell = tray.cells.findIndex((r) => rectContains(r, x, y));
  if (cell >= 0) return { kind: 'hand', slot: cell };
  const slot = railSlotAt(layout, x, y);
  if (slot !== null && slot < selected) return { kind: 'rail', index: slot };
  return null;
}
