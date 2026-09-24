import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { flightOffset } from '../src/render/scene';
import { BANNER_CAP, bannerCovers, layoutBanner } from '../src/terminal/bannerFont';
import { bannerGeometry } from '../src/terminal/waveBanner';

describe('wave flight (GDD §10.4)', () => {
  it('flies forward off the old field, jumps back at the swap and lands on the new one', () => {
    const d = 8;
    expect(flightOffset(0, d)).toBe(0);
    expect(flightOffset(0.25, d)).toBeLessThan(0);
    expect(flightOffset(0.499, d)).toBeCloseTo(-d, 1);
    expect(flightOffset(0.501, d)).toBeCloseTo(d, 1);
    expect(flightOffset(0.75, d)).toBeGreaterThan(0);
    expect(flightOffset(1, d)).toBe(0);
    expect(flightOffset(-1, d)).toBe(0);
  });
});

describe('wave banner font', () => {
  it('has a glyph for every character of every wave number', () => {
    for (let n = 1; n <= 99; n++) expect(bannerCovers(en['banner.wave'].replace('{n}', String(n))), String(n)).toBe(true);
  });

  it('lays out a line and extrudes it down-left, centred', () => {
    const { width, glyphs } = layoutBanner('Wave 1');
    expect(glyphs).toHaveLength(5);
    expect(width).toBeGreaterThan(0);
    const box = bannerGeometry('Wave 1');
    box.computeBoundingBox();
    const b = box.boundingBox!;
    // The front face is centred; the slanted back only adds room down-left.
    expect(b.max.x).toBeCloseTo(width / 2, 5);
    expect(b.max.y).toBeCloseTo(BANNER_CAP / 2, 5);
    expect(b.min.x).toBeLessThan(-width / 2);
    expect(b.min.y).toBeLessThan(-BANNER_CAP / 2);
    expect(b.max.z).toBeCloseTo(0, 5);
  });
});
