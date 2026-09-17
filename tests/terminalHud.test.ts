import { describe, expect, it } from 'vitest';
import { drawText, glyphRows, measureText, GLYPH_H } from '../src/terminal/crt/pixelFont';

describe('pixelFont', () => {
  it('has 5×7 glyphs for letters, digits and punctuation', () => {
    for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!.:/-+%?'* ") {
      const rows = glyphRows(ch);
      expect(rows).toHaveLength(GLYPH_H);
      for (const r of rows) expect(r).toMatch(/^[#.]{5}$/);
    }
  });

  it('upper-cases and falls back to ?', () => {
    expect(glyphRows('a')).toEqual(glyphRows('A'));
    expect(glyphRows('ж')).toEqual(glyphRows('?'));
  });

  it('measures text with a 1px gap', () => {
    expect(measureText('')).toBe(0);
    expect(measureText('A')).toBe(5);
    expect(measureText('AB', 2)).toBe(22);
  });

  it('draws one rect per lit pixel, scaled and offset', () => {
    const rects: number[][] = [];
    const sink = { fillStyle: '', fillRect: (x: number, y: number, w: number, h: number) => rects.push([x, y, w, h]) };
    drawText(sink, 'I', 10, 20, 2, '#fff');
    const lit = glyphRows('I').join('').split('').filter((c) => c === '#').length;
    expect(rects).toHaveLength(lit);
    expect(sink.fillStyle).toBe('#fff');
    expect(rects[0]).toEqual([10 + 1 * 2, 20, 2, 2]); // first row ".###."
  });
});
