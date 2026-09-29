import * as THREE from 'three';
import { tuning } from '../../config/tuning';
import { PALETTE } from '../../render/palette';
import { blinkPhase } from '../terminalMode';
import { chipMask, type StripItem, type StripTone } from './chargeStrip';
import {
  hudKey,
  type HpTag,
  type HudLabel,
  type HudModel,
  type HudStatus,
  type LabelTone,
} from './hudModel';
import { HUD_PX_PER_SCALE, menuLayout, type MenuSpec, type MenuTone } from './menuModel';
import { drawText, measureText, type PixelSink } from './pixelFont';

// HUD layer of the CRT (TERMINAL.md §7.1): drawn at the CRT resolution with the
// pixel font and composited over the battle by the CRT shader.

const hex = (v: number) => `#${v.toString(16).padStart(6, '0')}`;

const COLOR = {
  red: hex(PALETTE.red),
  accent: hex(PALETTE.accent),
  outline: hex(PALETTE.bg),
  hp: hex(PALETTE.phosphor),
  hpLow: hex(PALETTE.accent),
};

const MENU_COLOR: Record<MenuTone, string> = {
  title: '#ffe066',
  info: '#6fd3ff',
  win: '#7dff9a',
  lose: '#ff5a5a',
};

const MENU = {
  shade: 'rgba(3, 6, 10, 0.96)',
  subtitle: '#9aa6c4',
  rowLabel: '#9aa6c4',
  rowValue: '#e8dfc4',
  item: '#7d8aa3',
  itemActive: '#ffffff',
  itemBand: 'rgba(111, 211, 255, 0.18)',
  hint: '#6f7a8f',
};

/** Charge strip colours by tone (GDD §7.2): yellow is action, red is a loss. */
const STRIP_COLOR: Record<StripTone, number> = {
  queued: PALETTE.phosphor,
  active: PALETTE.accent,
  spent: PALETTE.phosphor,
  burned: PALETTE.red,
};
/** Brightness of a spent chip, of an icon's dim level and of the unlit phase of a blink. */
const SPENT_LEVEL = 0.3;
const DIM_LEVEL = 0.55;
const BLINK_LOW = 0.35;
/** Slot frames are this bright relative to their icon. */
const FRAME_LEVEL = 0.45;
/** Icon cell and slot, in icon pixels: a 16-pixel icon with a 2-pixel margin. */
const ICON_PX = 16;
const SLOT_PX = 20;
const SLOT_GAP_PX = 3;
/** The combo tick, 7×7, drawn two icon pixels per cell. */
const TICK = ['......#', '.....##', '#...##.', '##.##..', '.###...', '..#....', '.......'];
const PAUSE_LEVEL = 0.6;

/** `color` dimmed toward the background by `k` (0..1), as CSS. */
function dim(color: number, k: number): string {
  const bg = PALETTE.bg;
  const ch = (c: number, sh: number) => (c >> sh) & 255;
  const mix = (sh: number) => Math.round(ch(bg, sh) + (ch(color, sh) - ch(bg, sh)) * k);
  return `rgb(${mix(16)},${mix(8)},${mix(0)})`;
}

const LABEL_COLOR: Record<LabelTone, string> = {
  /** Damage dealt: hot yellow-white. */
  damage: '#fff0a8',
  playerDamage: hex(PALETTE.red),
};

export class CrtCanvas {
  readonly texture: THREE.CanvasTexture;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private lastKey = '';

  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas');
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.setSize(width, height);
  }

  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (w === this.canvas.width && h === this.canvas.height) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.lastKey = '';
    // A resized canvas needs new GPU storage.
    this.texture.dispose();
  }

  /** Redraws only when the visible content changes. */
  draw(m: HudModel, timeSec: number): void {
    const blinkOn = blinkPhase(timeSec);
    const key = hudKey(m, blinkOn);
    if (key === this.lastKey) return;
    this.lastKey = key;

    const { ctx } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const s = Math.max(1, Math.floor(W / HUD_PX_PER_SCALE));
    const M = 3 * s;
    const sink = ctx as unknown as PixelSink;
    ctx.clearRect(0, 0, W, H);
    if (m.menu) {
      this.drawMenu(ctx, sink, m.menu.spec, m.menu.cursor, blinkOn, W, H);
      this.texture.needsUpdate = true;
      return;
    }

    if (m.status) this.drawStatus(sink, m.status, H, s, M, blinkOn);
    this.drawStrip(ctx, sink, m.strip, W, H, s, M, blinkOn);
    if (m.pause) this.drawPause(ctx, s, M);
    this.drawHp(ctx, sink, m.hp, s);
    this.drawLabels(sink, m.labels);
    this.texture.needsUpdate = true;
  }

  /** The player's HP in the bottom-left corner (spec §8). */
  private drawStatus(sink: PixelSink, st: HudStatus, H: number, s: number, M: number, blinkOn: boolean): void {
    const big = s + 1;
    // A hit blinks the number; otherwise low HP just sits amber.
    const hpColor = st.hpHit && blinkOn ? COLOR.red : st.hpLow ? COLOR.hpLow : COLOR.hp;
    drawText(sink, String(st.hp), M, H - M - 7 * big, big, hpColor);
  }

  /**
   * The charge strip, centred at the bottom of the picture (GDD §7.2): one
   * framed slot per chip, then `?` or the combo tick.
   */
  private drawStrip(
    ctx: CanvasRenderingContext2D,
    sink: PixelSink,
    items: readonly StripItem[],
    W: number,
    H: number,
    s: number,
    M: number,
    blinkOn: boolean,
  ): void {
    if (items.length === 0) return;
    const u = Math.max(1, s - 1);
    const slot = SLOT_PX * u;
    const gap = SLOT_GAP_PX * u;
    const total = items.length * slot + (items.length - 1) * gap;
    let x = Math.round((W - total) / 2);
    const y = H - M - slot;
    for (const item of items) {
      if (item.kind === 'chip') {
        const blinkK = item.tone === 'burned' && !blinkOn ? BLINK_LOW : 1;
        const k = (item.tone === 'spent' ? SPENT_LEVEL : 1) * blinkK;
        const color = STRIP_COLOR[item.tone];
        this.frame(ctx, x, y, slot, u, dim(color, k * FRAME_LEVEL));
        const mask = chipMask(item.id);
        const bright = dim(color, k);
        const low = dim(color, k * DIM_LEVEL);
        const ox = x + ((SLOT_PX - ICON_PX) / 2) * u;
        const oy = y + ((SLOT_PX - ICON_PX) / 2) * u;
        for (let py = 0; py < mask.h; py++) {
          for (let px = 0; px < mask.w; px++) {
            const level = mask.levels[py * mask.w + px];
            if (!level) continue;
            ctx.fillStyle = level === 2 ? bright : low;
            ctx.fillRect(ox + px * u, oy + py * u, u, u);
          }
        }
      } else if (item.kind === 'ask') {
        const k = blinkOn ? 1 : BLINK_LOW;
        this.frame(ctx, x, y, slot, u, dim(PALETTE.phosphor, k * FRAME_LEVEL));
        const scale = 2 * u;
        drawText(sink, '?', x + (slot - 5 * scale) / 2, y + (slot - 7 * scale) / 2, scale, dim(PALETTE.phosphor, k));
      } else {
        const cell = 2 * u;
        const ox = x + (slot - TICK.length * cell) / 2;
        const oy = y + (slot - TICK.length * cell) / 2;
        ctx.fillStyle = dim(PALETTE.accent, 1);
        TICK.forEach((row, ty) => {
          for (let tx = 0; tx < row.length; tx++) if (row[tx] === '#') ctx.fillRect(ox + tx * cell, oy + ty * cell, cell, cell);
        });
      }
      x += slot + gap;
    }
  }

  /** A square outline `u` pixels thick. */
  private frame(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, u: number, color: string): void {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, size, u);
    ctx.fillRect(x, y + size - u, size, u);
    ctx.fillRect(x, y, u, size);
    ctx.fillRect(x + size - u, y, u, size);
  }

  /** The pause icon in the top-left corner: a framed `II` (TERMINAL.md §5.4). */
  private drawPause(ctx: CanvasRenderingContext2D, s: number, M: number): void {
    const size = 9 * s;
    const color = dim(PALETTE.phosphor, PAUSE_LEVEL);
    this.frame(ctx, M, M, size, Math.max(1, Math.floor(s / 2)), color);
    ctx.fillStyle = color;
    ctx.fillRect(M + 3 * s, M + 2 * s, s, 5 * s);
    ctx.fillRect(M + 5 * s, M + 2 * s, s, 5 * s);
  }

  /** Enemy HP as a small red number with a dark outline; level dots above it. */
  private drawHp(ctx: CanvasRenderingContext2D, sink: PixelSink, tags: readonly HpTag[], s: number): void {
    const scale = s;
    for (const b of tags) {
      const text = String(b.hp);
      const x = Math.round(b.x - measureText(text, scale) / 2);
      const y = Math.round(b.y - 7 * scale);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        drawText(sink, text, x + dx, y + dy, scale, COLOR.outline);
      }
      drawText(sink, text, x, y, scale, COLOR.red);
      // Level dots above the number.
      ctx.fillStyle = COLOR.accent;
      const dot = 2 * s;
      for (let i = 1; i < b.level; i++) {
        ctx.fillRect(Math.round(b.x + (i - b.level / 2 - 0.5) * dot * 2 + dot / 2), y - dot - 2, dot, dot);
      }
    }
  }

  /** Damage numbers: big pixel digits with a dark outline, centred on their anchors. */
  private drawLabels(sink: PixelSink, labels: readonly HudLabel[]): void {
    for (const l of labels) {
      const scale = l.scale ?? tuning.battleVisual.DAMAGE_SCALE;
      const x = Math.round(l.x - measureText(l.text, scale) / 2);
      const y = Math.round(l.y - (7 * scale) / 2);
      // A thick dark outline keeps big numbers readable over anything.
      for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        drawText(sink, l.text, x + dx, y + dy, scale, COLOR.outline);
      }
      drawText(sink, l.text, x, y, scale, LABEL_COLOR[l.tone]);
    }
  }

  /** Session menu over the whole screen (TERMINAL.md §8). */
  private drawMenu(
    ctx: CanvasRenderingContext2D,
    sink: PixelSink,
    spec: MenuSpec,
    cursor: number,
    blinkOn: boolean,
    W: number,
    H: number,
  ): void {
    const l = menuLayout(spec, W, H, cursor);
    ctx.fillStyle = MENU.shade;
    ctx.fillRect(0, 0, W, H);
    const tone = MENU_COLOR[spec.tone];
    drawText(sink, l.title.text, l.title.x, l.title.y, l.title.scale, tone);
    if (l.subtitle) drawText(sink, l.subtitle.text, l.subtitle.x, l.subtitle.y, l.subtitle.scale, MENU.subtitle);
    for (const r of l.rows) {
      drawText(sink, r.label.text.toUpperCase(), r.label.x, r.label.y, r.label.scale, MENU.rowLabel);
      drawText(sink, r.value.text, r.value.x, r.value.y, r.value.scale, MENU.rowValue);
    }
    for (const m of l.more) drawText(sink, m.text, m.x, m.y, m.scale, MENU.hint);
    l.items.forEach((item) => {
      const active = item.index === cursor;
      if (active) {
        ctx.fillStyle = MENU.itemBand;
        ctx.fillRect(item.rect.x, item.rect.y, item.rect.w, item.rect.h);
        if (blinkOn) drawText(sink, '>', item.rect.x + 2 * l.s, item.text.y, item.text.scale, tone);
      }
      drawText(sink, item.text.text, item.text.x, item.text.y, item.text.scale, active ? MENU.itemActive : MENU.item);
    });
    for (const h of l.hint) drawText(sink, h.text, h.x, h.y, h.scale, MENU.hint);
  }
}
