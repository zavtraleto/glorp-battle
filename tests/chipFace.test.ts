import { describe, expect, it } from 'vitest';
import { codeColor } from '../src/terminal/chips/codeColor';
import { BIG_ADVANCE, hasBigGlyphs, measureBig } from '../src/terminal/chips/cartFont';
import { faceNumber, PANEL_TEXT_W } from '../src/terminal/chips/chipFace';
import { CHIPS } from '../src/data/chips';

// The code letter carries its own colour so matching codes are spotted without
// reading (spec §9.1).
describe('code colour', () => {
  it('is stable for a code', () => {
    expect(codeColor('A')).toBe(codeColor('A'));
  });

  it('separates letters', () => {
    expect(codeColor('A')).not.toBe(codeColor('B'));
    expect(codeColor('A')).not.toBe(codeColor('N'));
  });

  it('gives the wildcard its own neutral colour', () => {
    const star = codeColor('*');
    for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') expect(star).not.toBe(codeColor(c as 'A'));
  });

  it('returns a hex colour for every code a chip can have', () => {
    for (const def of Object.values(CHIPS)) {
      for (const code of def.codes) expect(codeColor(code)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

// The cartridge's top panel is drawn with a font of its own (spec §6.1): a
// missing glyph would silently swallow a digit or a code letter.
describe('cartridge font', () => {
  it('has a glyph for every code a chip can have', () => {
    for (const def of Object.values(CHIPS)) {
      for (const code of def.codes) expect(hasBigGlyphs(code)).toBe(true);
    }
  });

  it('has a glyph for every number a face shows', () => {
    for (const def of Object.values(CHIPS)) {
      expect(hasBigGlyphs(faceNumber(def.id))).toBe(true);
    }
  });

  it('shows damage, healing with a plus, and nothing else', () => {
    expect(faceNumber('cannon')).toBe('40');
    expect(faceNumber('recov30')).toBe('+30');
    expect(faceNumber('invis')).toBe('');
  });

  it('keeps the panel text inside the panel', () => {
    // The number sits left and the code right; together with one glyph of gap
    // they must fit the room the panel keeps for them.
    for (const def of Object.values(CHIPS)) {
      for (const code of def.codes) {
        expect(measureBig(faceNumber(def.id)) + measureBig(code) + BIG_ADVANCE).toBeLessThanOrEqual(PANEL_TEXT_W);
      }
    }
  });
});
