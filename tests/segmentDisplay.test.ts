import { describe, expect, it } from 'vitest';
import { CHIPS, type ChipId } from '../src/data/chips';
import { chipBrief, chipName } from '../src/i18n';
import { trackballArmed } from '../src/terminal/controlRules';
import {
  DISPLAY_CHARS,
  glyph,
  hasGlyph,
  queueDisplayModel,
  QUEUE_SEP,
  QUEUE_SLOT,
} from '../src/terminal/chips/segmentFont';

// The amber queue display above the CRT (TERMINAL.md §3.1, decision 2026-09-28).
describe('14-segment display', () => {
  it('has a glyph for every character it can be asked to show', () => {
    const texts = [QUEUE_SLOT, QUEUE_SEP, '0123456789', ...(Object.keys(CHIPS) as ChipId[]).map((id) => chipName(id))];
    for (const text of texts) {
      for (const ch of text) expect(hasGlyph(ch), `${text}: '${ch}'`).toBe(true);
    }
  });

  it('draws different characters with different segments', () => {
    const seen = new Map<string, string>();
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-+_') {
      const key = [...glyph(ch)].sort().join(',');
      expect(seen.get(key), `${ch} looks like ${seen.get(key)}`).toBeUndefined();
      seen.set(key, ch);
    }
  });

  it('shows every chip as its brief plus power, drawable (GDD §6.5)', () => {
    for (const id of Object.keys(CHIPS) as ChipId[]) {
      const power = CHIPS[id].power;
      const full = power === null ? chipBrief(id) : `${chipBrief(id)} ${power}`;
      for (const ch of full) expect(hasGlyph(ch), `${id}: ${ch}`).toBe(true);
    }
  });
});

describe('queue display', () => {
  const cannon = { name: chipBrief('cannon'), power: CHIPS.cannon.power };
  const sword = { name: chipBrief('sword'), power: CHIPS.sword.power };

  it('offers three empty slots before anything is chosen, the first breathing', () => {
    const m = queueDisplayModel([], 3);
    expect(m.text.trimEnd()).toBe('____ + ____ + ____');
    expect(m.text).toHaveLength(DISPLAY_CHARS);
    expect(m.pulse).toEqual([0, QUEUE_SLOT.length]);
  });

  it('lists the chosen chips left to right, then the remaining slots', () => {
    const m = queueDisplayModel([cannon], 2);
    expect(m.text.trimEnd()).toBe(`LINE HIT ${CHIPS.cannon.power} + ____ + ____`);
    expect(m.text.slice(m.pulse![0], m.pulse![1])).toBe(QUEUE_SLOT);
  });

  it('clips chip text so the next empty slot always shows', () => {
    const long = { name: 'CRACK 3 AHEAD', power: 9 };
    const m = queueDisplayModel([long, long], 1);
    expect(m.text).toHaveLength(DISPLAY_CHARS);
    expect(m.text.endsWith(QUEUE_SEP + QUEUE_SLOT)).toBe(true);
    expect(m.text.startsWith('CRACK 3 AHEAD 9 + ')).toBe(true);
    expect(m.pulse).toEqual([DISPLAY_CHARS - QUEUE_SLOT.length, DISPLAY_CHARS]);
  });

  it('shows no slots once the charge runs: the active chip leads, nothing breathes', () => {
    const m = queueDisplayModel([sword, cannon], 0);
    expect(m.text.trimEnd()).toBe(`FRONT CUT ${CHIPS.sword.power} + LINE HIT ${CHIPS.cannon.power}`);
    expect(m.pulse).toBeNull();
  });

  it('blanks the display with nothing to show', () => {
    expect(queueDisplayModel([], 0)).toEqual({ text: ' '.repeat(DISPLAY_CHARS), pulse: null });
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
