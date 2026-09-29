import { describe, expect, it } from 'vitest';
import { CHIPS, type ChipId } from '../src/data/chips';
import { ENEMY_KINDS } from '../src/sim/enemies/enemyBase';
import { chipName, enemyName, t } from '../src/i18n';
import { PLAYER_ID } from '../src/sim/player';
import {
  BattleLog,
  chipLogName,
  LOG_COLS,
  LOG_FADE,
  LOG_MERGE_TIME,
  LOG_ROWS,
  logEvent,
  logQueued,
  wrapText,
} from '../src/terminal/chips/battleLog';
import { trackballArmed } from '../src/terminal/controlRules';
import { glyph, hasGlyph } from '../src/terminal/chips/segmentFont';

// The amber battle log left of the trackball (TERMINAL.md §3.1, decision 2026-09-28).
const kindOf = (id: number) => (id === 7 ? 'mettik' : null);

describe('14-segment display', () => {
  it('has a glyph for every character the log can show', () => {
    const chips = Object.keys(CHIPS) as ChipId[];
    const texts = [
      '0123456789',
      ...chips.map((id) => chipName(id)),
      ...chips.flatMap((id) => [t('log.queued', { chip: chipLogName(id) }), t('log.used', { chip: chipLogName(id) })]),
      ...ENEMY_KINDS.flatMap((k) => [t('log.killed', { name: enemyName(k) }), t('log.damage', { name: enemyName(k), n: 99 })]),
      t('log.damage', { name: t('log.you'), n: 10 }),
      t('log.combo', { n: 5 }),
      t('log.comboOk'),
      t('log.comboBreak'),
      t('log.wave', { n: 3 }),
      t('log.waveClear'),
    ];
    for (const text of texts) {
      for (const ch of text) expect(hasGlyph(ch), `${text}: '${ch}'`).toBe(true);
    }
  });

  it('draws different characters with different segments', () => {
    const seen = new Map<string, string>();
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-+_>') {
      const key = [...glyph(ch)].sort().join(',');
      expect(seen.get(key), `${ch} looks like ${seen.get(key)}`).toBeUndefined();
      seen.set(key, ch);
    }
  });

  it('names every chip as its brief plus power (GDD §6.5)', () => {
    const power = CHIPS.cannon.power;
    expect(chipLogName('cannon')).toBe(`LINE HIT ${power}`);
  });
});

describe('battle log', () => {
  it('wraps words into lines of the display width', () => {
    expect(wrapText('+ MINE 3 AHEAD 40', 14)).toEqual(['+ MINE 3 AHEAD', '40']);
    expect(wrapText('COMBO OK', 14)).toEqual(['COMBO OK']);
    for (const id of Object.keys(CHIPS) as ChipId[]) {
      const lines = wrapText(t('log.queued', { chip: chipLogName(id) }), LOG_COLS);
      for (const l of lines) expect(l.length).toBeLessThanOrEqual(LOG_COLS);
      expect(lines.length, id).toBeLessThanOrEqual(2);
    }
  });

  it('puts the newest line on top and dims the older ones', () => {
    const log = new BattleLog();
    log.line('Combo x3');
    log.line('Combo OK');
    const rows = log.view();
    expect(rows.map((r) => r.text)).toEqual(['COMBO OK', 'COMBO X3']);
    expect(rows[0]!.level).toBe(LOG_FADE[0]);
    expect(rows[1]!.level).toBeLessThan(rows[0]!.level);
  });

  it('keeps at most as many rows as the display has', () => {
    const log = new BattleLog();
    for (let i = 0; i < 20; i++) log.line(`Wave ${i}`);
    const rows = log.view();
    expect(rows).toHaveLength(LOG_ROWS);
    expect(rows[0]!.text).toBe('WAVE 19');
  });

  it('adds up quick hits on one target, but not slow ones or other targets', () => {
    const log = new BattleLog();
    logEvent(log, { type: 'damaged', targetId: 7, amount: 10, x: 0, y: 0, hpLeft: 30 }, kindOf, 0);
    logEvent(log, { type: 'damaged', targetId: 7, amount: 10, x: 0, y: 0, hpLeft: 20 }, kindOf, LOG_MERGE_TIME / 2);
    expect(log.view().map((r) => r.text)).toEqual(['METTIK -20']);
    logEvent(log, { type: 'damaged', targetId: 7, amount: 5, x: 0, y: 0, hpLeft: 15 }, kindOf, 5);
    logEvent(log, { type: 'damaged', targetId: PLAYER_ID, amount: 3, x: 0, y: 0, hpLeft: 97 }, kindOf, 5);
    expect(log.view().map((r) => r.text)).toEqual(['YOU -3', 'METTIK -5', 'METTIK -20']);
  });

  it('writes chips, kills, combos and waves; skips what is not worth a line', () => {
    const log = new BattleLog(LOG_COLS, 12);
    logQueued(log, 'cannon');
    logEvent(log, { type: 'chipUsed', defId: 'cannon', x: 0, y: 0 }, kindOf, 0);
    logEvent(log, { type: 'enemyKilled', id: 7, x: 0, y: 0 }, kindOf, 0);
    logEvent(log, { type: 'comboStarted', size: 2 }, kindOf, 0);
    logEvent(log, { type: 'comboBroken' }, kindOf, 0);
    logEvent(log, { type: 'waveSpawned', wave: 2, count: 3 }, kindOf, 0);
    logEvent(log, { type: 'drawReshuffled', count: 1 }, kindOf, 0);
    logEvent(log, { type: 'damaged', targetId: 99, amount: 5, x: 0, y: 0, hpLeft: 0 }, kindOf, 0);
    const power = CHIPS.cannon.power;
    expect(log.view().map((r) => r.text)).toEqual([
      'WAVE 2',
      'COMBO BREAK',
      'COMBO X2',
      'METTIK DOWN',
      `> LINE HIT ${power}`,
      `+ LINE HIT ${power}`,
    ]);
  });

  it('clears for a new battle', () => {
    const log = new BattleLog();
    log.line('Wave clear');
    log.clear();
    expect(log.view()).toEqual([]);
  });
});

describe('trackball ring', () => {
  it('burns in menus and when a loaded chip can fire, stays dark otherwise', () => {
    expect(trackballArmed('MENU', 'dull')).toBe(true);
    expect(trackballArmed('BATTLE', 'ok')).toBe(true);
    expect(trackballArmed('BATTLE', 'dull')).toBe(false);
    expect(trackballArmed('TRANSITION', 'ok')).toBe(false);
  });
});
