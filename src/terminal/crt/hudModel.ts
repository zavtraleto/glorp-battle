import type { ChipCode } from '../../data/chips';
import type { MenuSpec } from './menuModel';

// What the CRT HUD layer shows (spec §8). Everything the player needs lives on
// the screen: a status band with HP, the Refresh counter and the queued chip, plus
// enemy HP segments and damage numbers. Pure.

export type LabelTone = 'damage' | 'playerDamage' | 'heal';

/** A damage / heal number centred on a CRT pixel. */
export interface HudLabel {
  text: string;
  x: number;
  y: number;
  tone: LabelTone;
}

/** Enemy HP segments centred above an enemy (CRT pixels). */
export interface HpBar {
  x: number;
  y: number;
  filled: number;
  total: number;
  /** Virus level: level − 1 accent dots above the bar. */
  level: number;
}

/** The battle status band across the top of the picture, plus the chip line. */
export interface HudStatus {
  hp: number;
  /** HP at or below a quarter: the number turns amber. */
  hpLow: boolean;
  /** Just took damage: the number blinks for a moment. */
  hpHit: boolean;
  gaugeLit: number;
  gaugeTotal: number;
  gaugeFull: boolean;
  /** Active chip, or null for NO CHIP. */
  chip: { name: string; code: ChipCode } | null;
}

export interface HudModel {
  labels: HudLabel[];
  bars: HpBar[];
  /** Battle status; null in menus. */
  status: HudStatus | null;
  /** A session menu covers the whole CRT (TERMINAL.md §8). */
  menu: { spec: MenuSpec; cursor: number } | null;
}

export const EMPTY_HUD: HudModel = { labels: [], bars: [], status: null, menu: null };

/**
 * Lit segments of a gauge. The last one lights only at a truly full gauge, so
 * "ready" is unmistakable on both the ring and the CRT bar.
 */
export function gaugeSegments(value: number, total: number): number {
  if (value >= 1) return total;
  return Math.max(0, Math.min(total - 1, Math.floor(value * total)));
}

/** Redraw key: changes whenever the drawn HUD would change. */
export function hudKey(m: HudModel, blinkOn: boolean): string {
  return [
    m.status
      ? `${m.status.hp}${m.status.hpLow ? 'L' : ''}${m.status.hpHit ? (blinkOn ? 'H1' : 'H0') : ''}` +
        `:${m.status.gaugeLit}/${m.status.gaugeTotal}` +
        `${m.status.gaugeFull ? (blinkOn ? 'F1' : 'F0') : ''}:${m.status.chip ? m.status.chip.name + m.status.chip.code : '-'}`
      : '',
    m.menu ? `${m.menu.spec.key}:${m.menu.cursor}:${blinkOn ? 1 : 0}` : '',
    m.labels.map((l) => `${l.text}@${Math.round(l.x)},${Math.round(l.y)}`).join(';'),
    m.bars.map((b) => `${b.filled}/${b.total}L${b.level}@${Math.round(b.x)},${Math.round(b.y)}`).join(';'),
  ].join('|');
}
