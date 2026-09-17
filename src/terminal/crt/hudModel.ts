import type { Screen } from '../../app/session';
import type { ChipCode, ChipId } from '../../data/chips';
import { chipName, t } from '../../i18n';
import type { GameState } from '../../sim/world';

// What the CRT HUD and the housing indicators show (TERMINAL.md §7). Pure:
// decisions live here, drawing lives in crtCanvas / housing.

export interface HudSession {
  screen: Screen;
  battleIndex: number;
  battleCount: number;
}

export interface HudWorld {
  state: GameState;
  firstStart: boolean;
  player: { hp: number; maxHp: number };
  gauge: { value: number; full: boolean };
  chips: { queue: readonly { defId: ChipId; code: ChipCode }[] };
}

export type BannerTone = 'info' | 'win' | 'lose';

export interface BannerInfo {
  key: string;
  text: string;
  tone: BannerTone;
}

export interface HudModel {
  hp: number;
  hpLow: boolean;
  gauge: number;
  gaugeFull: boolean;
  /** Next chip, e.g. "CANNON A"; null when the queue is empty. */
  chip: string | null;
  banner: BannerInfo | null;
  /** Short-lived message, e.g. NO CHIP after a dull EXECUTE press. */
  notice: string | null;
  /** Chip described on the Custom Screen (the focused tray chip). */
  info: { defId: ChipId; code: ChipCode } | null;
}

/** HP at or below this share of max HP is shown as low. */
export const HP_LOW_SHARE = 0.25;

/** Battle banners (GDD §11). */
export function bannerFor(s: HudSession, w: Pick<HudWorld, 'state' | 'firstStart'>): BannerInfo | null {
  if (s.screen !== 'BATTLE') return null;
  switch (w.state) {
    case 'BATTLE_INTRO':
      return {
        key: `intro-${s.battleIndex}`,
        text: t('banner.battle', { n: s.battleIndex, total: s.battleCount }),
        tone: 'info',
      };
    case 'BATTLE_START':
      return w.firstStart ? { key: 'battle-start', text: t('banner.battleStart'), tone: 'info' } : null;
    case 'BATTLE_WON':
      return { key: 'won', text: t('banner.enemyDeleted'), tone: 'win' };
    case 'PLAYER_DEAD':
      return { key: 'dead', text: t('banner.gameOver'), tone: 'lose' };
    default:
      return null;
  }
}

export function hudModel(
  s: HudSession,
  w: HudWorld,
  notice: string | null = null,
  info: HudModel['info'] = null,
): HudModel {
  const next = w.chips.queue[0];
  return {
    hp: w.player.hp,
    hpLow: w.player.hp <= w.player.maxHp * HP_LOW_SHARE,
    gauge: w.gauge.value,
    gaugeFull: w.gauge.full,
    chip: next ? `${chipName(next.defId).toUpperCase()} ${next.code}` : null,
    banner: bannerFor(s, w),
    notice,
    info,
  };
}

/** Redraw key: changes whenever the drawn HUD would change. */
export function hudKey(m: HudModel, blinkOn: boolean): string {
  return [
    m.hp,
    m.hpLow ? 1 : 0,
    Math.round(m.gauge * 100),
    m.gaugeFull ? (blinkOn ? 'F1' : 'F0') : '',
    m.chip ?? '',
    m.banner?.key ?? '',
    m.notice ?? '',
    m.info ? `${m.info.defId}${m.info.code}` : '',
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
