import { describe, expect, it } from 'vitest';
import { hasBigGlyphs, measureBig } from '../src/terminal/chips/cartFont';
import { chargeSegments, CHIP_COLOR, FACE_W, faceNumber, PANEL_TEXT_W } from '../src/terminal/chips/chipFace';
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

// Charges cut the top panel into segments that go dark from the right (GDD §6.1).
describe('charge segments', () => {
  it('fills the whole panel with one segment for a single charge', () => {
    expect(chargeSegments(1, 1)).toEqual([{ x: 0, w: FACE_W, lit: true }]);
  });

  it('splits the panel with one-texel gaps and darkens spent charges from the right', () => {
    for (const max of [2, 3, 4, 5]) {
      const segs = chargeSegments(1, max);
      expect(segs).toHaveLength(max);
      expect(segs[0]?.x).toBe(0);
      const last = segs[max - 1];
      expect((last?.x ?? 0) + (last?.w ?? 0)).toBe(FACE_W);
      for (let i = 1; i < max; i++) {
        const prev = segs[i - 1];
        expect(segs[i]?.x).toBe((prev?.x ?? 0) + (prev?.w ?? 0) + 1);
      }
      expect(segs.map((s) => s.lit)).toEqual(segs.map((_, i) => i === 0));
    }
  });
});
