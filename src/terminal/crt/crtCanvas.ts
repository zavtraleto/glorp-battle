import * as THREE from 'three';
import { CHIPS } from '../../data/chips';
import { chipDesc, chipName, t } from '../../i18n';
import { CHIP_ICONS, ICON_PALETTE } from '../chips/chipIcons';
import { blinkPhase } from '../terminalMode';
import { hudKey, type BannerTone, type HudModel } from './hudModel';
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
