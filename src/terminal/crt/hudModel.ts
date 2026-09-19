import type { MenuSpec } from './menuModel';

// What the CRT HUD layer shows (spec §8): the player's HP in the bottom-left
// corner, enemy HP segments and damage numbers. The Refresh countdown lives on
// the draw strip and the loaded chip on the segment display under the rail. Pure.

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

/** The player's HP in the bottom-left corner of the picture. */
export interface HudStatus {
  hp: number;
  /** HP at or below a quarter: the number turns amber. */
  hpLow: boolean;
  /** Just took damage: the number blinks for a moment. */
  hpHit: boolean;
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

/** Redraw key: changes whenever the drawn HUD would change. */
export function hudKey(m: HudModel, blinkOn: boolean): string {
  return [
    m.status
      ? `${m.status.hp}${m.status.hpLow ? 'L' : ''}${m.status.hpHit ? (blinkOn ? 'H1' : 'H0') : ''}`
      : '',
    m.menu ? `${m.menu.spec.key}:${m.menu.cursor}:${blinkOn ? 1 : 0}` : '',
    m.labels.map((l) => `${l.text}@${Math.round(l.x)},${Math.round(l.y)}`).join(';'),
    m.bars.map((b) => `${b.filled}/${b.total}L${b.level}@${Math.round(b.x)},${Math.round(b.y)}`).join(';'),
  ].join('|');
}
