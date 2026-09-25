import { describe, expect, it } from 'vitest';
import { hasBigGlyphs, measureBig } from '../src/terminal/chips/cartFont';
import { CHIP_COLOR, faceNumber, PANEL_TEXT_W } from '../src/terminal/chips/chipFace';
import { CHIPS } from '../src/data/chips';

// Every chip carries a colour on its top panel (GDD §6.1); all red for now.
describe('chip colour', () => {
  it('gives every chip a panel colour', () => {
    for (const def of Object.values(CHIPS)) expect(CHIP_COLOR[def.color]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('paints every chip red for now', () => {
    for (const def of Object.values(CHIPS)) expect(def.color).toBe('red');
  });
});

// The cartridge's top panel is drawn with a font of its own (spec §6.1): a
// missing glyph would silently swallow a digit.
describe('cartridge font', () => {
  it('has a glyph for every number a face shows', () => {
    for (const def of Object.values(CHIPS)) {
      expect(hasBigGlyphs(faceNumber(def.id))).toBe(true);
    }
  });

  it('shows damage and leaves non-damaging support faces blank', () => {
    expect(faceNumber('cannon')).toBe('4');
    expect(faceNumber('guard')).toBe('');
    expect(faceNumber('block')).toBe('');
  });

  it('keeps the panel text inside the panel', () => {
    for (const def of Object.values(CHIPS)) {
      expect(measureBig(faceNumber(def.id))).toBeLessThanOrEqual(PANEL_TEXT_W);
    }
  });
});
