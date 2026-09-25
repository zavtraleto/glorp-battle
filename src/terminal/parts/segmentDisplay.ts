import * as THREE from 'three';
import {
  barCellSegments,
  DISPLAY_CHARS,
  DISPLAY_TOTAL_CHARS,
  glyph,
  SEGMENTS,
  TIMER_BANK_CHARS,
  type Stroke,
  type SegmentDisplayModel,
} from '../chips/segmentFont';

// Amber 14-segment display under the CRT (TERMINAL.md §3.1): the loaded chip's
// name in the centre, side bars for Combo State and the selection slow-mo
// timer. Unlit segments stay faintly visible, like a real vacuum fluorescent
// display.

const COLOR = {
  back: '#0d0904',
  lit: '#ffb13d',
  unlit: '#2a1a08',
  bezel: 0x0a0a0c,
};

/** Canvas pixels per character cell and the stroke of a segment. */
const CELL_W = 16;
const CELL_H = 26;
const PAD = 3;
const STROKE = 2.4;

type Line = [number, number, number, number];

/** Segment strokes inside one cell, in cell-local pixels. */
function segmentLines(): Record<Stroke, Line> {
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

export class SegmentDisplay {
  readonly group = new THREE.Group();
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly screen: THREE.Mesh;
  private readonly bezel: THREE.Mesh;
  private shown: string | null = null;

  constructor() {
    this.canvas.width = DISPLAY_TOTAL_CHARS * CELL_W + PAD * 2;
    this.canvas.height = CELL_H + PAD * 2;
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
    this.set('');
  }

  /** Aspect (w/h) of the glass; the caller sizes the display with it. */
  get aspect(): number {
    return this.canvas.width / this.canvas.height;
  }

  /** Right edge at `right`, vertically centred on `cy`, `h` tall (world units). */
  place(right: number, cy: number, h: number): void {
    const w = h * this.aspect;
    this.screen.scale.set(w, h, 1);
    // In front of the bezel's face (z 0.06), or the bezel wins the depth test.
    this.screen.position.set(right - w / 2, cy, 0.09);
    const rim = h * 0.06;
    this.bezel.scale.set(w + rim * 2, h + rim * 2, 0.08);
    this.bezel.position.set(right - w / 2, cy, 0.02);
  }

  /** Shows the fixed label and the side bars; redraws only on change. */
  set(value: string | SegmentDisplayModel): void {
    const model: SegmentDisplayModel = typeof value === 'string' ? { text: value, barHalves: 0 } : value;
    const key = `${model.text}|${model.barHalves}`;
    if (key === this.shown) return;
    this.shown = key;
    const ctx = this.ctx;
    ctx.fillStyle = COLOR.back;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.lineWidth = STROKE;
    ctx.lineCap = 'round';
    for (let i = 0; i < DISPLAY_TOTAL_CHARS; i++) {
      const right = TIMER_BANK_CHARS + DISPLAY_CHARS;
      const on = new Set(
        i < TIMER_BANK_CHARS
          ? barCellSegments('left', TIMER_BANK_CHARS - 1 - i, model.barHalves)
          : i >= right
            ? barCellSegments('right', i - right, model.barHalves)
            : glyph(model.text[i - TIMER_BANK_CHARS] ?? ' '),
      );
      const x0 = PAD + i * CELL_W;
      // A slight italic slant, as on real segment displays.
      const slant = (y: number) => (CELL_H - y) * 0.12;
      for (const seg of SEGMENTS) {
        const [x1, y1, x2, y2] = LINES[seg];
        ctx.strokeStyle = on.has(seg) ? COLOR.lit : COLOR.unlit;
        ctx.beginPath();
        ctx.moveTo(x0 + x1 + slant(y1), PAD + y1);
        ctx.lineTo(x0 + x2 + slant(y2), PAD + y2);
        ctx.stroke();
      }
      if (on.has('dp')) {
        ctx.fillStyle = COLOR.lit;
        ctx.fillRect(x0 + CELL_W / 2 - STROKE / 2, PAD + CELL_H - 2.5 - STROKE / 2, STROKE, STROKE);
      }
    }
    this.texture.needsUpdate = true;
  }
}
