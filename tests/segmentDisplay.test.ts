import { describe, expect, it } from 'vitest';
import { CHIPS, type ChipId } from '../src/data/chips';
import { chipName, t } from '../src/i18n';
import { trackballArmed } from '../src/terminal/controlRules';
import {
  barCellSegments,
  chipDisplayText,
  comboDisplayModel,
  DISPLAY_CHARS,
  DISPLAY_TOTAL_CHARS,
  glyph,
  hasGlyph,
  SEGMENTS,
  TIMER_BANK_CHARS,
  TIMER_BANK_HALVES,
} from '../src/terminal/chips/segmentFont';

// The amber chip display under the rail and the trackball ring (TERMINAL.md §3.1).
describe('14-segment display', () => {
  it('has a glyph for every character it can be asked to show', () => {
    const ids = Object.keys(CHIPS) as ChipId[];
    const texts = [
      t('hud.selectChip'), '+0123456789',
      ...ids.map((id) => chipName(id)),
      ...ids.map((id) => t('hud.chipLost', { name: chipName(id) })),
    ];
    for (const text of texts) {
      for (const ch of text) expect(hasGlyph(ch), `${text}: '${ch}'`).toBe(true);
    }
  });

  it('draws different characters with different segments', () => {
    const seen = new Map<string, string>();
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-+') {
      const key = [...glyph(ch)].sort().join(',');
      expect(seen.get(key), `${ch} looks like ${seen.get(key)}`).toBeUndefined();
      seen.set(key, ch);
    }
  });

  it('fits every <CHIP> LOST line into the centre characters', () => {
    for (const id of Object.keys(CHIPS) as ChipId[]) {
      expect(t('hud.chipLost', { name: chipName(id) }).length).toBeLessThanOrEqual(DISPLAY_CHARS);
    }
  });

  it('shows NO CHIP for an empty queue', () => {
    expect(chipDisplayText([], t('hud.selectChip'))).toBe(' SELECT CHIP  ');
  });

  it('centres the first loaded chip with its damage and never shows the queue count', () => {
    expect(chipDisplayText([{ name: 'Cannon', power: 4 }], 'NO CHIP')).toBe('   CANNON 4   ');
    expect(chipDisplayText([
      { name: 'Cannon', power: 4 },
      { name: 'Sword', power: 8 },
      { name: 'Sword', power: 8 },
    ], 'NO CHIP')).toBe('   CANNON 4   ');
  });

  it('shows only the name of a chip without damage', () => {
    expect(chipDisplayText([{ name: 'Guard', power: null }], 'NO CHIP')).toBe('    GUARD     ');
  });

  it('always fits the wider display', () => {
    expect(DISPLAY_CHARS).toBe(14);
    for (const id of Object.keys(CHIPS) as ChipId[]) {
      const def = CHIPS[id];
      const text = chipDisplayText([{ name: chipName(id), power: def.power }], 'NO CHIP');
      expect(text).toHaveLength(DISPLAY_CHARS);
      expect(text).not.toContain('+');
    }
  });

  it('keeps full side bars while Combo State is active', () => {
    const entry = { name: 'Sword', power: 6 };
    const active = comboDisplayModel(entry, 'NO CHIP', true, 0.2);

    expect(active).toEqual({ text: '   SWORD 6    ', barHalves: TIMER_BANK_HALVES });
    expect(active.text).toHaveLength(DISPLAY_CHARS);
    expect(DISPLAY_TOTAL_CHARS).toBe(DISPLAY_CHARS + TIMER_BANK_CHARS * 2);
  });

  it('turns the side bars off with no combo and no selection timer', () => {
    expect(comboDisplayModel({ name: 'Cannon', power: 4 }, 'NO CHIP', false)).toEqual({
      text: '   CANNON 4   ',
      barHalves: 0,
    });
  });

  it('shows the selection slow-mo left in half-cell steps (GDD §6.7)', () => {
    const bars = (left: number) => comboDisplayModel(null, 'NO CHIP', false, left).barHalves;
    expect(bars(1)).toBe(TIMER_BANK_HALVES);
    expect(bars(0.5)).toBe(TIMER_BANK_HALVES / 2);
    expect(bars(0.001)).toBe(1);
    expect(bars(0)).toBe(0);
  });

  it('shrinks the bars toward the label, splitting the last cell in half', () => {
    expect(barCellSegments('left', 0, 3)).toBe(SEGMENTS);
    expect(barCellSegments('left', 1, 3)).toEqual(['b', 'c', 'g2', 'j', 'm']);
    expect(barCellSegments('right', 1, 3)).toEqual(['f', 'e', 'g1', 'h', 'k']);
    expect(barCellSegments('right', 2, 3)).toEqual([]);
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
