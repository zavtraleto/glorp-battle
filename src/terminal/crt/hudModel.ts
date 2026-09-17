import type { ChipCode, ChipId } from '../../data/chips';
import type { MenuSpec } from './menuModel';

// What the CRT HUD layer shows (TERMINAL.md §7, BATTLE_VISUAL.md §7). Battle
// has no text: only enemy HP segments and damage numbers; menus and the chip
// description are text. Pure.

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

export interface HudModel {
  labels: HudLabel[];
  bars: HpBar[];
  /** Chip described on the Custom Screen (the focused tray chip). */
  info: { defId: ChipId; code: ChipCode } | null;
  /** A session menu covers the whole CRT (TERMINAL.md §8). */
  menu: { spec: MenuSpec; cursor: number } | null;
  /** Heading over the chip description (REWARD). */
  title: string | null;
}

export const EMPTY_HUD: HudModel = { labels: [], bars: [], info: null, menu: null, title: null };

/** Redraw key: changes whenever the drawn HUD would change. */
export function hudKey(m: HudModel, blinkOn: boolean): string {
  return [
    m.info ? `${m.info.defId}${m.info.code}` : '',
    m.title ?? '',
    m.menu ? `${m.menu.spec.key}:${m.menu.cursor}:${blinkOn ? 1 : 0}` : '',
    m.labels.map((l) => `${l.text}@${Math.round(l.x)},${Math.round(l.y)}`).join(';'),
    m.bars.map((b) => `${b.filled}/${b.total}L${b.level}@${Math.round(b.x)},${Math.round(b.y)}`).join(';'),
  ].join('|');
}

export function hpLedCount(hp: number, maxHp: number, leds: number): number {
  if (maxHp <= 0) return 0;
  return Math.max(0, Math.min(leds, Math.ceil((leds * hp) / maxHp)));
}

export function gaugeLedCount(value: number, full: boolean, leds: number): number {
  if (full) return leds;
  return Math.max(0, Math.min(leds - 1, Math.floor(value * leds)));
}
