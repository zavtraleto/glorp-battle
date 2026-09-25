import type { GameState } from '../../sim/world';
import type { MenuSpec } from './menuModel';

// What the CRT HUD layer shows (spec §8): the player's HP in the bottom-left
// corner, enemy HP segments and damage numbers. Draw information lives on
// the draw strip and the loaded chip on the segment display under the rail. Pure.

export type LabelTone = 'damage' | 'playerDamage';

/** A damage number centred on a CRT pixel. */
export interface HudLabel {
  text: string;
  x: number;
  y: number;
  tone: LabelTone;
  /** Pixel-font scale; defaults to DAMAGE_SCALE. */
  scale?: number;
}

/** Enemy HP numbers wait until a new wave has materialized (GDD §10.4). */
export function enemyHpVisible(state: GameState): boolean {
  return state !== 'WAVE_INTRO';
}

/** Enemy HP as a small number centred above an enemy (CRT pixels), decision 2026-09-19. */
export interface HpTag {
  x: number;
  y: number;
  hp: number;
  /** Virus level: level − 1 accent dots above the number. */
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
  hp: HpTag[];
  /** Battle status; null in menus. */
  status: HudStatus | null;
  /** A session menu covers the whole CRT (TERMINAL.md §8). */
  menu: { spec: MenuSpec; cursor: number } | null;
}

export const EMPTY_HUD: HudModel = { labels: [], hp: [], status: null, menu: null };

/** Redraw key: changes whenever the drawn HUD would change. */
export function hudKey(m: HudModel, blinkOn: boolean): string {
  return [
    m.status
      ? `${m.status.hp}${m.status.hpLow ? 'L' : ''}${m.status.hpHit ? (blinkOn ? 'H1' : 'H0') : ''}`
      : '',
    m.menu ? `${m.menu.spec.key}:${m.menu.cursor}:${blinkOn ? 1 : 0}` : '',
    m.labels.map((l) => `${l.text}@${Math.round(l.x)},${Math.round(l.y)}`).join(';'),
    m.hp.map((b) => `${b.hp}L${b.level}@${Math.round(b.x)},${Math.round(b.y)}`).join(';'),
  ].join('|');
}
