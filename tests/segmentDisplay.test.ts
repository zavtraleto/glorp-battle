import { describe, expect, it } from 'vitest';
import { CHIPS, type ChipId } from '../src/data/chips';
import { chipName, t } from '../src/i18n';
import { trackballArmed } from '../src/terminal/controlRules';
import { chipDisplayText, DISPLAY_CHARS, glyph, hasGlyph } from '../src/terminal/chips/segmentFont';

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
    expect(chipDisplayText([], t('hud.selectChip'))).toBe('SELECT CHIP');
  });

  it('shows the first loaded chip and how many more follow it', () => {
    expect(chipDisplayText(['Cannon'], 'NO CHIP')).toBe('CANNON');
    expect(chipDisplayText(['Cannon', 'Sword', 'Sword'], 'NO CHIP')).toBe('CANNON +2');
  });

  it('always fits the display', () => {
    for (const id of Object.keys(CHIPS) as ChipId[]) {
      const text = chipDisplayText([chipName(id), 'x', 'x', 'x', 'x'], 'NO CHIP');
      expect(text.length).toBeLessThanOrEqual(DISPLAY_CHARS);
      expect(text.endsWith('+4')).toBe(true);
    }
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
