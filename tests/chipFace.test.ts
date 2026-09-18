import { describe, expect, it } from 'vitest';
import { codeColor } from '../src/terminal/chips/codeColor';
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
