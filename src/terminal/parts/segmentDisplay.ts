import * as THREE from 'three';
import type { LogRow } from '../chips/battleLog';
import { glyph, SEGMENTS, type Segment } from '../chips/segmentFont';

// Amber 14-segment display on the control panel, left of the trackball
// (TERMINAL.md §3.1): the battle log, newest line on top, older lines dimmer
// (decision 2026-09-28). Unlit segments stay faintly visible, like a real
// vacuum fluorescent display.

const COLOR = {
  back: '#0d0904',
  lit: '#ffb13d',
  unlit: '#2a1a08',
  bezel: 0x0a0a0c,
};

/** Canvas pixels per character cell, the gap between rows and the stroke of a segment. */
const CELL_W = 16;
const CELL_H = 26;
const ROW_GAP = 6;
const PAD = 4;
const STROKE = 2.4;

type Line = [number, number, number, number];

/** Segment strokes inside one cell, in cell-local pixels. */
function segmentLines(): Record<Segment, Line> {
  const l = 2.5;
  const r = CELL_W - 4.5;
  const t = 2.5;
  const b = CELL_H - 2.5;
  const m = CELL_H / 2;
  const c = (l + r) / 2;
  const g = 1.6;
  return {
    a: [l + g, t, r - g, t],
    b: [r, t + g, r, m - g],
    c: [r, m + g, r, b - g],
    d: [l + g, b, r - g, b],
    e: [l, m + g, l, b - g],
    f: [l, t + g, l, m - g],
    g1: [l + g, m, c - g * 0.6, m],
    g2: [c + g * 0.6, m, r - g, m],
    h: [l + g * 1.4, t + g * 1.6, c - g, m - g * 1.4],
    i: [c, t + g, c, m - g],
    j: [r - g * 1.4, t + g * 1.6, c + g, m - g * 1.4],
    k: [l + g * 1.4, b - g * 1.6, c - g, m + g * 1.4],
    l: [c, m + g, c, b - g],
    m: [r - g * 1.4, b - g * 1.6, c + g, m + g * 1.4],
  };
}

const LINES = segmentLines();

/** `a` → `b` by `k`, as a CSS colour; both are #rrggbb. */
function mixColor(a: string, b: string, k: number): string {
  const ch = (c: string, i: number) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * k));
  return `rgb(${out.join(',')})`;
}

export class SegmentDisplay {
  readonly group = new THREE.Group();
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly screen: THREE.Mesh;
  private readonly bezel: THREE.Mesh;
  private shown: string | null = null;

  constructor(
    readonly cols: number,
    readonly rows: number,
  ) {
    this.canvas.width = cols * CELL_W + PAD * 2;
    this.canvas.height = rows * CELL_H + (rows - 1) * ROW_GAP + PAD * 2;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.texture }));
    this.bezel = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: COLOR.bezel, flatShading: true }),
    );
    this.group.add(this.bezel, this.screen);
    this.set([]);
  }

  /** Aspect (w/h) of the glass; the caller sizes the display with it. */
  get aspect(): number {
    return this.canvas.width / this.canvas.height;
  }

  /** Centred on (`cx`, `cy`), `h` tall (world units). */
  place(cx: number, cy: number, h: number): void {
    const w = h * this.aspect;
    this.screen.scale.set(w, h, 1);
    // In front of the bezel's face (z 0.06), or the bezel wins the depth test.
    this.screen.position.set(cx, cy, 0.09);
    const rim = h * 0.04;
    this.bezel.scale.set(w + rim * 2, h + rim * 2, 0.08);
    this.bezel.position.set(cx, cy, 0.02);
  }

  /** Shows `rows` top to bottom, each at its own brightness. Redraws only on change. */
  set(rows: readonly LogRow[]): void {
    const key = rows.map((r) => `${r.text}@${r.level}`).join('|');
    if (key === this.shown) return;
    this.shown = key;
    const ctx = this.ctx;
    ctx.fillStyle = COLOR.back;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.lineWidth = STROKE;
    ctx.lineCap = 'round';
    // A slight italic slant, as on real segment displays.
    const slant = (y: number) => (CELL_H - y) * 0.12;
    for (let row = 0; row < this.rows; row++) {
      const r = rows[row];
      const lit = mixColor(COLOR.unlit, COLOR.lit, r?.level ?? 0);
      const y0 = PAD + row * (CELL_H + ROW_GAP);
      for (let i = 0; i < this.cols; i++) {
        const on = new Set(glyph(r?.text[i] ?? ' '));
        const x0 = PAD + i * CELL_W;
        for (const seg of SEGMENTS) {
          const [x1, y1, x2, y2] = LINES[seg];
          ctx.strokeStyle = on.has(seg) ? lit : COLOR.unlit;
          ctx.beginPath();
          ctx.moveTo(x0 + x1 + slant(y1), y0 + y1);
          ctx.lineTo(x0 + x2 + slant(y2), y0 + y2);
          ctx.stroke();
        }
      }
    }
    this.texture.needsUpdate = true;
  }
}
