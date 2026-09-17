import * as THREE from 'three';
import { CHIPS } from '../../data/chips';
import { chipDesc, chipName, t } from '../../i18n';
import { CHIP_ICONS, ICON_PALETTE } from '../chips/chipIcons';
import { blinkPhase } from '../terminalMode';
import { hudKey, type BannerTone, type HudLabel, type HudModel, type LabelTone } from './hudModel';
import { menuLayout, type MenuSpec, type MenuTone } from './menuModel';
import { drawText, measureText, wrapText, type PixelSink } from './pixelFont';

// HUD layer of the CRT (TERMINAL.md §7.1): drawn at the CRT resolution with the
// pixel font and composited over the battle by the CRT shader.

const COLOR = {
  hp: '#7dff9a',
  hpLow: '#ffb347',
  gauge: '#6fd3ff',
  gaugeFlash: '#e8fbff',
  gaugeBack: 'rgba(10, 20, 30, 0.8)',
  chip: '#ffe066',
  band: 'rgba(0, 0, 0, 0.6)',
  notice: '#ffb347',
  shade: 'rgba(4, 8, 12, 0.9)',
  infoName: '#e8dfc4',
  infoText: '#9fe8ff',
  infoPower: '#ffd166',
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
  enemyHp: '#e8dfc4',
  damage: '#ffffff',
  playerDamage: '#ff8a3d',
  heal: '#7dff9a',
};
const LABEL_OUTLINE = '#07090c';

const BANNER_COLOR: Record<BannerTone, string> = {
  info: '#6fd3ff',
  win: '#7dff9a',
  lose: '#ff5a5a',
};

/** Gauge bar width as a share of the CRT width. */
const GAUGE_W = 0.38;
/** Vertical centre of the banner band as a share of the CRT height. */
const BANNER_Y = 0.45;

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

    this.drawLabels(ctx, sink, m.labels, s);

    // HP box, top-left.
    const hpText = String(m.hp);
    const hpColor = m.hpLow ? COLOR.hpLow : COLOR.hp;
    const boxW = Math.max(measureText('000', s), measureText(hpText, s)) + 4 * s;
    const boxH = 7 * s + 4 * s;
    ctx.fillStyle = COLOR.gaugeBack;
    ctx.fillRect(M, M, boxW, boxH);
    ctx.strokeStyle = hpColor;
    ctx.lineWidth = s;
    ctx.strokeRect(M + s / 2, M + s / 2, boxW - s, boxH - s);
    drawText(sink, hpText, M + boxW - 2 * s - measureText(hpText, s), M + 2 * s, s, hpColor);

    // Custom gauge, top-right.
    const barW = Math.round(W * GAUGE_W);
    const barH = 4 * s;
    const barX = W - M - barW;
    const label = t('hud.custom');
    drawText(sink, label, barX + Math.round((barW - measureText(label, s)) / 2), M, s, COLOR.gauge);
    const barY = M + 8 * s;
    ctx.fillStyle = COLOR.gaugeBack;
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = m.gaugeFull && blinkOn ? COLOR.gaugeFlash : COLOR.gauge;
    ctx.fillRect(barX + s, barY + s, Math.round((barW - 2 * s) * Math.min(1, m.gauge)), barH - 2 * s);
    ctx.strokeStyle = COLOR.gauge;
    ctx.strokeRect(barX + s / 2, barY + s / 2, barW - s, barH - s);

    if (m.info) this.drawInfo(ctx, sink, m.info, W, H, s, M);

    // Next chip, bottom-left; a notice (NO CHIP) takes the same line.
    const bottomY = H - M - 7 * s;
    if (m.notice) {
      const tw = measureText(m.notice, s);
      ctx.fillStyle = COLOR.band;
      ctx.fillRect(M - s, bottomY - 2 * s, tw + 2 * s, 11 * s);
      drawText(sink, m.notice, M, bottomY, s, COLOR.notice);
    } else if (m.chip) {
      drawText(sink, m.chip, M, bottomY, s, COLOR.chip);
    }

    // Banner across the middle.
    if (m.banner) {
      const big = measureText(m.banner.text, s + 1) <= W - 2 * M ? s + 1 : s;
      const bandH = 7 * big + 8 * s;
      const bandY = Math.round(H * BANNER_Y - bandH / 2);
      ctx.fillStyle = COLOR.band;
      ctx.fillRect(0, bandY, W, bandH);
      const tw = measureText(m.banner.text, big);
      drawText(sink, m.banner.text, Math.round((W - tw) / 2), bandY + 4 * s, big, BANNER_COLOR[m.banner.tone]);
    }

    this.texture.needsUpdate = true;
  }

  /** Enemy HP and damage numbers with a dark outline, centred on their anchors. */
  private drawLabels(ctx: CanvasRenderingContext2D, sink: PixelSink, labels: readonly HudLabel[], s: number): void {
    for (const l of labels) {
      const scale = l.tone === 'enemyHp' ? Math.max(1, s - 1) : s;
      const x = Math.round(l.x - measureText(l.text, scale) / 2);
      const y = Math.round(l.y - (7 * scale) / 2);
      ctx.globalAlpha = l.alpha;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        drawText(sink, l.text, x + dx * scale, y + dy * scale, scale, LABEL_OUTLINE);
      }
      drawText(sink, l.text, x, y, scale, LABEL_COLOR[l.tone]);
    }
    ctx.globalAlpha = 1;
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
    const l = menuLayout(spec, W, H);
    ctx.fillStyle = MENU.shade;
    ctx.fillRect(0, 0, W, H);
    const tone = MENU_COLOR[spec.tone];
    drawText(sink, l.title.text, l.title.x, l.title.y, l.title.scale, tone);
    if (l.subtitle) drawText(sink, l.subtitle.text, l.subtitle.x, l.subtitle.y, l.subtitle.scale, MENU.subtitle);
    for (const r of l.rows) {
      drawText(sink, r.label.text.toUpperCase(), r.label.x, r.label.y, r.label.scale, MENU.rowLabel);
      drawText(sink, r.value.text, r.value.x, r.value.y, r.value.scale, MENU.rowValue);
    }
    l.items.forEach((item, i) => {
      const active = i === cursor;
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
