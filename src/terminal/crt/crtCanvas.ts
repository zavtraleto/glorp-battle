import * as THREE from 'three';
import { tuning } from '../../config/tuning';
import { CHIPS } from '../../data/chips';
import { chipDesc, chipName } from '../../i18n';
import { PALETTE } from '../../render/palette';
import { CHIP_ICONS, ICON_PALETTE } from '../chips/chipIcons';
import { blinkPhase } from '../terminalMode';
import { hudKey, type HpBar, type HudLabel, type HudModel, type LabelTone } from './hudModel';
import { menuLayout, type MenuSpec, type MenuTone } from './menuModel';
import { drawText, measureText, wrapText, type PixelSink } from './pixelFont';

// HUD layer of the CRT (TERMINAL.md §7.1): drawn at the CRT resolution with the
// pixel font and composited over the battle by the CRT shader.

const hex = (v: number) => `#${v.toString(16).padStart(6, '0')}`;

const COLOR = {
  shade: 'rgba(4, 8, 12, 0.9)',
  infoName: '#e8dfc4',
  infoText: '#9fe8ff',
  infoPower: '#ffd166',
  red: hex(PALETTE.red),
  accent: hex(PALETTE.accent),
  outline: hex(PALETTE.bg),
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
  damage: hex(PALETTE.accent),
  playerDamage: hex(PALETTE.red),
  heal: hex(PALETTE.phosphor),
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
    const s = Math.max(1, Math.floor(W / 120));
    const M = 3 * s;
    const sink = ctx as unknown as PixelSink;
    ctx.clearRect(0, 0, W, H);
    if (m.menu) {
      this.drawMenu(ctx, sink, m.menu.spec, m.menu.cursor, blinkOn, W, H);
      this.texture.needsUpdate = true;
      return;
    }

    this.drawBars(ctx, m.bars, s);
    this.drawLabels(sink, m.labels);
    if (m.info) this.drawInfo(ctx, sink, m.info, W, H, s, M);
    if (m.title) {
      if (!m.info) {
        ctx.fillStyle = COLOR.shade;
        ctx.fillRect(0, 0, W, H);
      }
      drawText(sink, m.title, Math.round((W - measureText(m.title, s + 1)) / 2), M + 4 * s, s + 1, COLOR.infoPower);
    }
    this.texture.needsUpdate = true;
  }

  /** Enemy HP as a row of big segments: lit = red block, lost = red outline. */
  private drawBars(ctx: CanvasRenderingContext2D, bars: readonly HpBar[], s: number): void {
    const size = 2 * s;
    const gap = Math.max(1, Math.floor(s / 2));
    for (const b of bars) {
      const width = b.total * size + (b.total - 1) * gap;
      const x0 = Math.round(b.x - width / 2);
      const y0 = Math.round(b.y - size);
      ctx.fillStyle = COLOR.outline;
      ctx.fillRect(x0 - 1, y0 - 1, width + 2, size + 2);
      for (let i = 0; i < b.total; i++) {
        const x = x0 + i * (size + gap);
        ctx.fillStyle = COLOR.red;
        if (i < b.filled) {
          ctx.fillRect(x, y0, size, size);
        } else {
          ctx.fillRect(x, y0, size, 1);
          ctx.fillRect(x, y0 + size - 1, size, 1);
          ctx.fillRect(x, y0, 1, size);
          ctx.fillRect(x + size - 1, y0, 1, size);
        }
      }
      // Level dots above the bar.
      ctx.fillStyle = COLOR.accent;
      for (let i = 1; i < b.level; i++) {
        ctx.fillRect(Math.round(b.x + (i - b.level / 2 - 0.5) * size * 2 + size / 2), y0 - size - gap, size, size);
      }
    }
  }

  /** Damage and heal numbers: big pixel digits with a dark outline, centred on their anchors. */
  private drawLabels(sink: PixelSink, labels: readonly HudLabel[]): void {
    const scale = tuning.battleVisual.DAMAGE_SCALE;
    for (const l of labels) {
      const x = Math.round(l.x - measureText(l.text, scale) / 2);
      const y = Math.round(l.y - (7 * scale) / 2);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
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

  /** Custom Screen: the focused chip, large, over the dimmed field (TERMINAL.md §6.4). */
  private drawInfo(
    ctx: CanvasRenderingContext2D,
    sink: PixelSink,
    info: NonNullable<HudModel['info']>,
    W: number,
    H: number,
    s: number,
    M: number,
  ): void {
    const top = M + 18 * s;
    ctx.fillStyle = COLOR.shade;
    ctx.fillRect(0, top - 2 * s, W, H - top + 2 * s);

    const icon = CHIP_ICONS[info.defId];
    const scale = 3 * s;
    const ix = Math.round((W - 16 * scale) / 2);
    const iy = top + 6 * s;
    icon.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const color = ICON_PALETTE[row[x] as string];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(ix + x * scale, iy + y * scale, scale, scale);
      }
    });

    let y = iy + 16 * scale + 6 * s;
    const name = `${chipName(info.defId).toUpperCase()} ${info.code}`;
    const nameScale = measureText(name, s + 1) <= W - 2 * M ? s + 1 : s;
    drawText(sink, name, Math.round((W - measureText(name, nameScale)) / 2), y, nameScale, COLOR.infoName);
    y += 7 * nameScale + 4 * s;
    const power = CHIPS[info.defId].power;
    if (power !== null) {
      const p = String(power);
      drawText(sink, p, Math.round((W - measureText(p, s)) / 2), y, s, COLOR.infoPower);
      y += 11 * s;
    }
    for (const line of wrapText(chipDesc(info.defId).toUpperCase(), Math.floor((W - 2 * M) / (6 * s)))) {
      drawText(sink, line, M, y, s, COLOR.infoText);
      y += 9 * s;
    }
  }
}
