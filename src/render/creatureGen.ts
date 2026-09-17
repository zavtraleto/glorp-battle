import { Rng } from '../core/rng';

// Procedural occult creatures (BATTLE_VISUAL.md §5.1):
// seed → body + appendages → mirror symmetry and deformation → 1–3 inner
// elements (holes and one accent) → pixel bitmap. Pure.

/** 0 empty, 1 body (main colour), 2 accent. */
export type Pixel = 0 | 1 | 2;

export interface CreatureBitmap {
  w: number;
  h: number;
  px: Uint8Array;
  /** Names of the inner elements, for tests and debugging. */
  elements: string[];
}

export const CREATURE_SIZE = 32;
const MIN_COVERAGE = 0.25;
const MAX_ELEMENTS = 3;

type BodyKind = 'orb' | 'totem' | 'wedge' | 'crown';
type ElementKind = 'eyes' | 'cyclops' | 'mouth' | 'sigil' | 'organ';

class Canvas {
  readonly px: Uint8Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.px = new Uint8Array(w * h);
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): Pixel {
    return this.inside(x, y) ? (this.px[y * this.w + x] as Pixel) : 0;
  }

  set(x: number, y: number, v: Pixel): void {
    if (this.inside(x, y)) this.px[y * this.w + x] = v;
  }

  /** Sets a pixel and its mirror across the vertical centre line. */
  mirror(x: number, y: number, v: Pixel): void {
    this.set(x, y, v);
    this.set(this.w - 1 - x, y, v);
  }

  /** Changes only body pixels (inner elements stay inside the silhouette). */
  carve(x: number, y: number, v: Pixel, mirrored: boolean): void {
    if (this.get(x, y) === 1) this.set(x, y, v);
    if (mirrored && this.get(this.w - 1 - x, y) === 1) this.set(this.w - 1 - x, y, v);
  }

  line(x0: number, y0: number, x1: number, y1: number, v: Pixel, mirrored: boolean): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / steps);
      const y = Math.round(y0 + ((y1 - y0) * i) / steps);
      if (mirrored) this.mirror(x, y, v);
      else this.set(x, y, v);
    }
  }

  coverage(): number {
    let n = 0;
    for (const p of this.px) if (p !== 0) n++;
    return n / this.px.length;
  }
}

export function generateCreature(seed: number, size = CREATURE_SIZE): CreatureBitmap {
  let grow = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    const bitmap = build(seed, size, grow);
    const c = bitmap.px.reduce((n, p) => n + (p !== 0 ? 1 : 0), 0) / bitmap.px.length;
    if (c >= MIN_COVERAGE) return bitmap;
    grow += 1.5;
  }
  return build(seed, size, grow);
}

function build(seed: number, size: number, grow: number): CreatureBitmap {
  const rng = new Rng(seed);
  const c = new Canvas(size, size);
  const cx = (size - 1) / 2;
  const k = size / CREATURE_SIZE;

  // ---- Body: a mirrored, wobbly silhouette ----
  const body: BodyKind = rng.pick(['orb', 'totem', 'wedge', 'crown'] as const);
  const lobes = rng.int(3, 6);
  const phase = rng.next() * Math.PI * 2;
  const wobble = 0.1 + rng.next() * 0.14;
  const rx = (body === 'totem' ? 6 + rng.int(0, 2) : 8 + rng.int(0, 3)) * k + grow;
  const ry = (body === 'totem' ? 11 + rng.int(0, 2) : 8 + rng.int(0, 3)) * k + grow;
  const cy = size * 0.45;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.abs(x - cx);
      const dy = y - cy;
      const a = Math.atan2(dy, dx);
      const r = 1 + wobble * Math.sin(lobes * a + phase);
      let inside: boolean;
      if (body === 'wedge') {
        // Wide at the top, narrowing downwards.
        const t = (dy + ry) / (2 * ry);
        inside = t >= 0 && t <= 1 && dx <= rx * r * (1 - 0.75 * t);
      } else {
        inside = (dx / (rx * r)) ** 2 + (dy / (ry * r)) ** 2 <= 1;
      }
      if (inside) c.set(x, y, 1);
    }
  }
  const top = Math.round(cy - ry);
  const bottom = Math.round(cy + ry * (body === 'wedge' ? 1 : 0.85));

  // ---- Appendages ----
  if (body === 'crown' || rng.next() < 0.35) {
    const spikes = rng.int(1, 3);
    for (let i = 0; i < spikes; i++) {
      const x0 = Math.round(cx - 1 - i * 3 * k);
      const len = rng.int(4, 7) * k;
      c.line(x0, top + 2, x0 - rng.int(0, 3), Math.max(0, top - len), 1, true);
    }
  }
  const tentacles = rng.int(0, 3);
  for (let i = 0; i < tentacles; i++) {
    const x = Math.round(cx - 2 - i * 3 * k);
    const sway = rng.next() * Math.PI * 2;
    const thick = rng.next() < 0.5 ? 2 : 1;
    for (let y = bottom - 2; y < size; y++) {
      const off = Math.round(Math.sin((y - bottom) * 0.45 + sway) * 1.5) - Math.floor((y - bottom) / 4);
      for (let t = 0; t < thick; t++) c.mirror(x + off - t, y, 1);
    }
  }
  if (rng.next() < 0.3) {
    // Broken halo above the head.
    const hr = rx + 3;
    for (let s = 0; s < 40; s++) {
      if (s % 5 === 4) continue;
      const a = Math.PI + (s / 40) * Math.PI;
      c.mirror(Math.round(cx + Math.cos(a) * hr), Math.round(cy - 2 + Math.sin(a) * (ry + 3)), 1);
    }
  }
  // One asymmetric feature: a stray limb on one side.
  if (rng.next() < 0.35) {
    const y0 = Math.round(cy + rng.int(-2, 4));
    c.line(Math.round(cx + rx - 1), y0, Math.min(size - 1, Math.round(cx + rx + rng.int(3, 6))), y0 + rng.int(-4, 4), 1, false);
  }

  // ---- Inner elements: 1–3 of holes / accents inside the silhouette ----
  const count = rng.int(1, MAX_ELEMENTS);
  const pool: ElementKind[] = ['eyes', 'cyclops', 'mouth', 'sigil', 'organ'];
  const elements: string[] = [];
  const eyeY = Math.round(cy - ry * 0.25);
  for (let i = 0; i < count && pool.length > 0; i++) {
    const kind = pool.splice(rng.int(0, pool.length - 1), 1)[0] as ElementKind;
    if (kind === 'cyclops' && elements.includes('eyes')) continue;
    if (kind === 'eyes' && elements.includes('cyclops')) continue;
    elements.push(kind);
    switch (kind) {
      case 'eyes': {
        const ex = Math.round(cx - 3 - rng.int(0, 2));
        const er = rng.int(1, 2);
        disc(c, ex, eyeY, er, 0, true);
        c.mirror(ex, eyeY, 2);
        break;
      }
      case 'cyclops': {
        const r = rng.int(3, 4);
        disc(c, Math.round(cx), eyeY, r, 0, true);
        disc(c, Math.round(cx), eyeY, 1, 2, true, true);
        break;
      }
      case 'mouth': {
        const my = Math.round(cy + ry * 0.35);
        const half = rng.int(2, 4);
        for (let x = Math.round(cx) - half; x <= Math.round(cx); x++) {
          c.carve(x, my, 0, true);
          // Teeth: every other column is left standing on the lower lip.
          if ((x & 1) === 0) c.carve(x, my + 1, 0, true);
        }
        break;
      }
      case 'sigil': {
        const sy = Math.round(cy + ry * 0.05);
        const s = rng.int(2, 3);
        const mark: Pixel = elements.includes('organ') ? 0 : 2;
        // Inverted triangle.
        for (let d = -s; d <= s; d++) {
          c.carve(Math.round(cx) + d, sy - s, mark, false);
          c.carve(Math.round(cx) + d, sy - s + (s - Math.abs(d)), mark, false);
        }
        break;
      }
      case 'organ': {
        disc(c, Math.round(cx), Math.round(cy + ry * 0.1), 2, 2, true, true);
        break;
      }
    }
  }

  return { w: size, h: size, px: c.px, elements };
}

function disc(c: Canvas, x0: number, y0: number, r: number, v: Pixel, mirrored: boolean, force = false): void {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y > r * r + r * 0.5) continue;
      if (force) {
        if (mirrored) c.mirror(x0 + x, y0 + y, v);
        else c.set(x0 + x, y0 + y, v);
      } else {
        c.carve(x0 + x, y0 + y, v, mirrored);
      }
    }
  }
}
