import { describe, expect, it } from 'vitest';
import { CHIPS, type ChipId } from '../src/data/chips';
import { chipName, t } from '../src/i18n';
import { trackballArmed } from '../src/terminal/controlRules';
import {
  chipDisplayText,
  comboDisplayModel,
  DISPLAY_CHARS,
  DISPLAY_TOTAL_CHARS,
  glyph,
  hasGlyph,
  TIMER_BANK_CHARS,
} from '../src/terminal/chips/segmentFont';

// The amber chip display under the rail and the trackball ring (TERMINAL.md §3.1).
describe('14-segment display', () => {
  it('has a glyph for every character it can be asked to show', () => {
    const texts = [t('hud.selectChip'), '+0123456789', ...(Object.keys(CHIPS) as ChipId[]).map((id) => chipName(id))];
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

  it('shows multi-hit damage and healing values', () => {
    expect(chipDisplayText([{ name: 'Vulcan', power: 1, hits: 3 }], 'NO CHIP')).toBe('  VULCAN 1X3  ');
    expect(chipDisplayText([{ name: 'Recov3', power: null, heal: 3 }], 'NO CHIP')).toBe('   RECOV3 3   ');
    expect(chipDisplayText([{ name: 'Barrier', power: null }], 'NO CHIP')).toBe('   BARRIER    ');
  });

  it('always fits the wider display', () => {
    expect(DISPLAY_CHARS).toBe(14);
    for (const id of Object.keys(CHIPS) as ChipId[]) {
      const def = CHIPS[id];
      const text = chipDisplayText([{ name: chipName(id), power: def.power, heal: def.heal, hits: def.hits }], 'NO CHIP');
      expect(text).toHaveLength(DISPLAY_CHARS);
      expect(text).not.toContain('+');
    }
  });

  it('keeps full symmetric side banks while Combo State is active', () => {
    const entry = { name: 'Sword', power: 6 };
    const active = comboDisplayModel(entry, 'NO CHIP', true);

    expect(active).toEqual({
      text: '   SWORD 6    ',
      leftLit: TIMER_BANK_CHARS,
      rightLit: TIMER_BANK_CHARS,
    });
    expect(active.text).toHaveLength(DISPLAY_CHARS);
    expect(DISPLAY_TOTAL_CHARS).toBe(DISPLAY_CHARS + TIMER_BANK_CHARS * 2);
  });

  it('turns both side banks off outside Combo State', () => {
    expect(comboDisplayModel({ name: 'Cannon', power: 4 }, 'NO CHIP', false)).toEqual({
      text: '   CANNON 4   ',
      leftLit: 0,
      rightLit: 0,
    });
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
