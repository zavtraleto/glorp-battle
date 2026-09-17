import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, type Tuning } from '../src/config/tuning';
import { EventBus } from '../src/core/events';
import { FixedStepClock } from '../src/core/loop';
import { Rng, deriveSeed } from '../src/core/rng';
import { parseDebugParams } from '../src/debug/params';
import { inTerritory, sideOfRow } from '../src/sim/grid';
import { CHIPS } from '../src/data/chips';
import { ENEMY_SEEDS } from '../src/data/enemies';
import { chipDesc, chipName, enemyName, t } from '../src/i18n';

describe('FixedStepClock', () => {
  const make = () => new FixedStepClock({ hz: 60, maxFrameTime: 0.25 });

  it('runs 60 ticks per simulated second regardless of frame rate', () => {
    for (const fps of [30, 60, 120, 144]) {
      const c = make();
      let ticks = 0;
      for (let i = 0; i < fps; i++) ticks += c.advance(1 / fps);
      expect(Math.abs(ticks - 60)).toBeLessThanOrEqual(1);
    }
  });

  it('clamps long frames to avoid tick bursts', () => {
    const c = make();
    expect(c.advance(5)).toBe(15);
  });

  it('applies time scale', () => {
    const c = make();
    c.timeScale = 0.5;
    let ticks = 0;
    for (let i = 0; i < 60; i++) ticks += c.advance(1 / 60);
    expect(Math.abs(ticks - 30)).toBeLessThanOrEqual(1);
  });

  it('only runs queued steps while paused', () => {
    const c = make();
    c.paused = true;
    expect(c.advance(1)).toBe(0);
    c.stepOnce(3);
    expect(c.advance(1 / 60)).toBe(3);
    expect(c.advance(1 / 60)).toBe(0);
  });

  it('keeps alpha within [0, 1)', () => {
    const c = make();
    c.advance(0.025);
    expect(c.alpha).toBeGreaterThanOrEqual(0);
    expect(c.alpha).toBeLessThan(1);
  });
});

describe('Rng', () => {
  it('is deterministic for the same seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('produces different sequences for different seeds', () => {
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });

  it('int stays within inclusive bounds and hits both ends', () => {
    const r = new Rng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = r.int(2, 4);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(4);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([2, 3, 4]);
  });

  it('shuffle is a deterministic permutation', () => {
    const src = Array.from({ length: 30 }, (_, i) => i);
    const a = new Rng(99).shuffle([...src]);
    const b = new Rng(99).shuffle([...src]);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(src);
    expect(a).not.toEqual(src);
  });

  it('forked streams are independent and stable', () => {
    expect(deriveSeed(5, 'folder')).toBe(deriveSeed(5, 'folder'));
    expect(deriveSeed(5, 'folder')).not.toBe(deriveSeed(5, 'ai'));
    expect(new Rng(5).fork('ai').next()).toBe(new Rng(5).fork('ai').next());
  });
});

describe('EventBus', () => {
  it('delivers payloads and supports unsubscribe', () => {
    const bus = new EventBus<{ ping: { n: number } }>();
    const got: number[] = [];
    const off = bus.on('ping', (p) => got.push(p.n));
    bus.emit('ping', { n: 1 });
    off();
    bus.emit('ping', { n: 2 });
    expect(got).toEqual([1]);
  });
});

describe('tuning', () => {
  it('merges only known keys with matching types', () => {
    const dst = JSON.parse(JSON.stringify(DEFAULT_TUNING)) as Tuning;
    mergeTuning(dst, { player: { MOVE_COOLDOWN: 0.5, UNKNOWN: 1 }, gauge: { GAUGE_FILL_TIME: 'fast' }, nope: { A: 1 } });
    expect(dst.player.MOVE_COOLDOWN).toBe(0.5);
    expect(dst.gauge.GAUGE_FILL_TIME).toBe(8);
    expect('UNKNOWN' in dst.player).toBe(false);
  });

  it('matches GDD defaults for key MMBN1 values', () => {
    expect(DEFAULT_TUNING.player.PLAYER_MAX_HP).toBe(100);
    expect(DEFAULT_TUNING.chips.HAND_MAX).toBe(15);
    expect(DEFAULT_TUNING.mettik.MET_HP).toBe(40);
  });
});

describe('debug params', () => {
  it('parses and clamps values', () => {
    const p = parseDebugParams('?debug=1&seed=123&battle=9&folder=p1&god=1&timescale=0.5');
    expect(p).toMatchObject({ debug: true, seed: 123, battle: 4, folder: 'p1', god: true, timescale: 0.5 });
  });

  it('falls back to defaults', () => {
    const p = parseDebugParams('?seed=abc');
    expect(p).toMatchObject({ debug: false, seed: null, battle: 1, folder: 'mvp', god: false, timescale: 1 });
  });
});

describe('grid', () => {
  it('splits territories at row 3', () => {
    expect(sideOfRow(2)).toBe('enemy');
    expect(sideOfRow(3)).toBe('player');
    expect(inTerritory('player', 1, 4)).toBe(true);
    expect(inTerritory('player', 1, 2)).toBe(false);
    expect(inTerritory('enemy', 3, 0)).toBe(false);
  });
});

describe('i18n', () => {
  it('returns English strings and fills placeholders', () => {
    expect(t('banner.battleStart')).toBe('BATTLE START!');
    expect(t('banner.battle', { n: 2, total: 4 })).toBe('BATTLE 2/4');
  });

  it('has a name and description for every chip and a name for every enemy', () => {
    for (const id of Object.keys(CHIPS)) {
      expect(chipName(id)).not.toContain('chip.');
      expect(chipDesc(id)).not.toContain('chip.');
    }
    for (const kind of Object.keys(ENEMY_SEEDS)) expect(enemyName(kind)).not.toContain('enemy.');
  });
});
