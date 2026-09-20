import * as THREE from 'three';
import { tuning } from '../../config/tuning';
import { PALETTE } from '../../render/palette';
import { blinkPhase } from '../terminalMode';
import { hudKey, type HpTag, type HudLabel, type HudModel, type HudStatus, type LabelTone } from './hudModel';
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

const LABEL_COLOR: Record<LabelTone, string> = {
  /** Damage dealt: hot yellow-white. */
  damage: '#fff0a8',
  playerDamage: hex(PALETTE.red),
  heal: hex(PALETTE.phosphor),
};

/** The hint line sits this many CRT pixels above the player's HP number (tutorial spec §5). */
const HINT_LIFT = 18;

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
    this.drawHp(ctx, sink, m.hp, s);
    this.drawLabels(sink, m.labels);
    if (m.hint) this.drawHint(sink, m.hint, W, H, s, M);
    this.texture.needsUpdate = true;
  }

  /** The player's HP in the bottom-left corner (spec §8). */
  private drawStatus(sink: PixelSink, st: HudStatus, H: number, s: number, M: number, blinkOn: boolean): void {
    const big = s + 1;
    // A hit blinks the number; otherwise low HP just sits amber.
    const hpColor = st.hpHit && blinkOn ? COLOR.red : st.hpLow ? COLOR.hpLow : COLOR.hp;
    drawText(sink, String(st.hp), M, H - M - 7 * big, big, hpColor);
  }

  /** Tutorial hint: one centred line above the player's HP (tutorial spec §5). */
  private drawHint(sink: PixelSink, text: string, W: number, H: number, s: number, M: number): void {
    const big = s + 1;
    const x = Math.round((W - measureText(text, big)) / 2);
    // Sits a line above the HP number in the bottom-left corner.
    const y = H - M - 7 * big - HINT_LIFT * s;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      drawText(sink, text, x + dx, y + dy, big, COLOR.outline);
    }
    drawText(sink, text, x, y, big, COLOR.accent);
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

  /** Damage and heal numbers: big pixel digits with a dark outline, centred on their anchors. */
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
