import type { ChipId } from '../../data/chips';
import { CHIP_ICONS, ICON_PALETTE } from '../chips/chipIcons';

// The charge strip under the field (GDD §7.2, decision 2026-09-28): the chips of
// the current charge left to right as monochrome icons, then `?` while another
// chip may be added, or `✓` once a multi-chip charge runs as a combo. Pure.

/** How a chip in the strip is lit. */
export type StripTone = 'queued' | 'active' | 'spent' | 'burned';

export type StripItem =
  | { kind: 'chip'; id: ChipId; tone: StripTone }
  /** Room for another chip: the hint to pick one. */
  | { kind: 'ask' }
  /** A combo is running: the charge is locked in. */
  | { kind: 'combo' };

export interface ChargeStripInput {
  /** Chips of the current charge already fired, in order. */
  spent: readonly ChipId[];
  /** The chip being used right now. */
  active: ChipId | null;
  /** Chosen chips still waiting to fire, in order. */
  queued: readonly ChipId[];
  /** The charge is still being built (no Attack yet). */
  selecting: boolean;
  /** Combo State is running (GDD §6.6). */
  combo: boolean;
  /** Tail burned by a Combo Break, still flashing. */
  burned: readonly ChipId[];
}

/** `cells`: how many slots the hint offers (`hand.QUEUE_CELLS`); longer charges still show every chip. */
export function chargeStrip(s: ChargeStripInput, cells: number): StripItem[] {
  const items: StripItem[] = [];
  for (const id of s.spent) items.push({ kind: 'chip', id, tone: 'spent' });
  if (s.active) items.push({ kind: 'chip', id: s.active, tone: 'active' });
  for (const id of s.queued) items.push({ kind: 'chip', id, tone: 'queued' });
  for (const id of s.burned) items.push({ kind: 'chip', id, tone: 'burned' });
  if (s.burned.length > 0) return items;
  if (s.selecting && s.queued.length < cells) items.push({ kind: 'ask' });
  else if (s.combo) items.push({ kind: 'combo' });
  return items;
}

/** What the terminal reads from the sim each frame. */
export interface ChargeFrame {
  active: ChipId | null;
  queued: readonly ChipId[];
  selecting: boolean;
  combo: boolean;
}

/**
 * Remembers what the sim no longer holds: the chips of the charge already fired
 * and, for a moment, the tail a Combo Break burned. Fed by sim events.
 */
export class ChargeTracker {
  /** Chips used in this charge, the active one last. */
  private fired: ChipId[] = [];
  private burned: ChipId[] = [];
  private burnLeft = 0;
  private lastQueued: readonly ChipId[] = [];

  chipUsed(id: ChipId): void {
    this.fired.push(id);
  }

  /** An unresolved chip went back to its slot (GDD §6.5). */
  chipInterrupted(id: ChipId): void {
    if (this.fired[this.fired.length - 1] === id) this.fired.pop();
  }

  /** The unfired tail burns; it flashes for `seconds`. */
  comboBroken(seconds: number): void {
    this.burned = [...this.lastQueued];
    this.burnLeft = seconds;
  }

  reset(): void {
    this.fired = [];
    this.burned = [];
    this.burnLeft = 0;
    this.lastQueued = [];
  }

  /** Advances the flash and returns the strip input for this frame. */
  update(dt: number, f: ChargeFrame): ChargeStripInput {
    if (this.burnLeft > 0) {
      this.burnLeft -= dt;
      if (this.burnLeft <= 0) {
        this.burned = [];
        this.fired = [];
      }
    }
    this.lastQueued = f.queued;
    if (this.burned.length > 0) {
      return { spent: this.fired, active: null, queued: [], selecting: false, combo: false, burned: this.burned };
    }
    // A charge being built has fired nothing yet.
    if (f.selecting) this.fired = [];
    const spent = f.active ? this.fired.slice(0, -1) : this.fired;
    return { spent, active: f.active, queued: f.queued, selecting: f.selecting, combo: f.combo, burned: [] };
  }
}

/** Redraw key of a strip. */
export function stripKey(items: readonly StripItem[]): string {
  return items.map((i) => (i.kind === 'chip' ? `${i.id}:${i.tone}` : i.kind)).join(',');
}

/**
 * A monochrome icon: `w × h` levels, 0 = transparent, 1 = dim, 2 = bright.
 * Every icon source goes through this shape, so PNG art can replace the
 * pixel tables later without touching the strip.
 */
export interface IconMask {
  w: number;
  h: number;
  levels: Uint8Array;
}

/** Palette luminance at or above this is the bright level. */
const BRIGHT_LUMA = 0.5;

function luma(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Pixel-table icon → mask: the black outline drops out, colours split into two levels. */
export function maskFromRows(rows: readonly string[]): IconMask {
  const h = rows.length;
  const w = Math.max(0, ...rows.map((r) => r.length));
  const levels = new Uint8Array(w * h);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = row[x] ?? '.';
      if (c === '.' || c === 'k') continue;
      const color = ICON_PALETTE[c];
      if (!color) continue;
      levels[y * w + x] = luma(color) >= BRIGHT_LUMA ? 2 : 1;
    }
  });
  return { w, h, levels };
}

const masks = new Map<ChipId, IconMask>();

/** The strip icon of a chip. */
export function chipMask(id: ChipId): IconMask {
  let m = masks.get(id);
  if (!m) {
    m = maskFromRows(CHIP_ICONS[id]);
    masks.set(id, m);
  }
  return m;
}
