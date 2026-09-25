import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { FxView } from '../src/render/fx';
import { buildRowProgress } from '../src/render/hologramMaterial';
import type { World } from '../src/sim/world';
import { BANNER_CAP, bannerCovers, layoutBanner } from '../src/terminal/bannerFont';
import { bannerGeometry } from '../src/terminal/waveBanner';

describe('wave materialize (GDD §10.4)', () => {
  it('builds the sprite line by line from the bottom and finishes every line', () => {
    // Same curve as the hologram shader: row 0 is the bottom line.
    expect(buildRowProgress(0, 0, 0)).toBe(0);
    expect(buildRowProgress(0.3, 0, 0)).toBeGreaterThan(buildRowProgress(0.3, 0.8, 0));
    expect(buildRowProgress(0.3, 0.8, 0)).toBe(0);
    for (const y of [0, 0.25, 0.5, 0.99]) for (const jitter of [0, 0.5, 1]) expect(buildRowProgress(1, y, jitter)).toBe(1);
  });
});

describe('wave field swap', () => {
  it('drops the effects of the old field so they do not play on the new one', () => {
    const fx = new FxView();
    const world = { playerTick: 100, tick: 100 } as unknown as World;
    fx.handleEvent({ type: 'enemyKilled', id: 7, x: 1, y: 1 }, world);
    fx.handleEvent({ type: 'enemyShot', x: 0, fromY: 0, toY: 5 }, world);
    expect(fx.timedCount).toBe(2);
    fx.handleEvent({ type: 'waveField', wave: 2 }, world);
    expect(fx.timedCount).toBe(0);
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
