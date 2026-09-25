import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, tuning, type Tuning } from '../src/config/tuning';
import { CHIPS } from '../src/data/chips';
import {
  TOOLS_GROUPS,
  TUNE_LAYOUT,
  changedValues,
  formatChanges,
  layoutGroups,
  matchesFilter,
  resetGroups,
  sliderRange,
  tuningControlKind,
} from '../src/debug/tuningLayout';

const fresh = (): Tuning => JSON.parse(JSON.stringify(DEFAULT_TUNING)) as Tuning;

beforeEach(() => mergeTuning(tuning, fresh()));

describe('tuning groups', () => {
  it('gives every chip its own group with startup and recovery', () => {
    for (const id of Object.keys(CHIPS) as (keyof typeof CHIPS)[]) {
      expect(DEFAULT_TUNING[id], id).toMatchObject({ STARTUP: expect.any(Number), RECOVERY: expect.any(Number) });
    }
    expect(DEFAULT_TUNING.cannon).toMatchObject({ DAMAGE: 4, STARTUP: 0.1, RECOVERY: 0.15 });
  });

  it('keeps the five attack phases and the move time for every enemy', () => {
    for (const group of ['mettik', 'canodron', 'hopzap', 'bladdy'] as const) {
      expect(DEFAULT_TUNING[group], group).toMatchObject({
        INTENTION_TIME: expect.any(Number),
        LOCK_TIME: expect.any(Number),
        COUNTER_TIME: expect.any(Number),
        STRIKE_TIME: expect.any(Number),
        RECOVERY_TIME: expect.any(Number),
        MOVE_TIME: expect.any(Number),
        HP: expect.any(Number),
        DMG: expect.any(Number),
      });
    }
  });

  it('holds the 2026-09-25 tempo pass', () => {
    expect(DEFAULT_TUNING.combo.WORLD_TIME_SCALE).toBe(0.85);
    expect(DEFAULT_TUNING.mettik.ACTION_DELAY).toBe(0.4);
    expect(DEFAULT_TUNING.canodron.RECOVERY_TIME).toBe(1.0);
    expect(DEFAULT_TUNING.flow).toMatchObject({ INTRO_TIME: 0.6, WAVE_FLIGHT_TIME: 0.7, RESULT_DELAY_WIN: 0.9 });
    // A wave's last deletion must finish before the flight starts.
    expect(DEFAULT_TUNING.flow.WAVE_CLEAR_TIME).toBeGreaterThanOrEqual(DEFAULT_TUNING.fx.DELETE_ANIM_TIME);
  });
});

describe('panel layout', () => {
  it('shows every tuning group exactly once across the Tune and Tools tabs', () => {
    const shown = [...layoutGroups(TUNE_LAYOUT), ...TOOLS_GROUPS];
    expect([...shown].sort()).toEqual(Object.keys(DEFAULT_TUNING).sort());
    expect(new Set(shown).size).toBe(shown.length);
  });

  it('puts chips and enemies into their own top folders', () => {
    const chips = TUNE_LAYOUT.find((f) => f.title === 'Chips');
    const enemies = TUNE_LAYOUT.find((f) => f.title === 'Enemies');
    expect(layoutGroups(chips ? [chips] : []).sort()).toEqual(Object.keys(CHIPS).sort());
    expect(layoutGroups(enemies ? [enemies] : [])).toEqual(['enemy', 'mettik', 'canodron', 'hopzap', 'bladdy']);
  });
});

describe('changed values', () => {
  it('lists only values that differ from the defaults, in layout order', () => {
    const v = fresh();
    expect(changedValues(v, DEFAULT_TUNING)).toEqual([]);
    v.mettik.ACTION_DELAY = 0.45;
    v.combo.WORLD_TIME_SCALE = 0.9;
    v.hologram.GLOW_COLOR = '#FFFFFF';
    expect(changedValues(v, DEFAULT_TUNING)).toEqual([
      { group: 'combo', key: 'WORLD_TIME_SCALE', from: 0.85, to: 0.9 },
      { group: 'mettik', key: 'ACTION_DELAY', from: 0.4, to: 0.45 },
      { group: 'hologram', key: 'GLOW_COLOR', from: '#8ACE00', to: '#FFFFFF' },
    ]);
  });

  it('ignores float noise from sliders', () => {
    const v = fresh();
    v.combo.WORLD_TIME_SCALE = 0.85 + 1e-12;
    expect(changedValues(v, DEFAULT_TUNING)).toEqual([]);
  });

  it('formats changes as one "group.KEY: from → to" line each', () => {
    expect(formatChanges([
      { group: 'mettik', key: 'ACTION_DELAY', from: 0.4, to: 0.45 },
      { group: 'combo', key: 'WORLD_TIME_SCALE', from: 0.85, to: 0.9 },
    ])).toBe('mettik.ACTION_DELAY: 0.4 → 0.45\ncombo.WORLD_TIME_SCALE: 0.85 → 0.9');
    expect(formatChanges([])).toBe('');
  });

  it('resets only the given groups', () => {
    const v = fresh();
    v.mettik.HP = 9;
    v.cannon.DAMAGE = 1;
    resetGroups(v, DEFAULT_TUNING, ['mettik']);
    expect(v.mettik.HP).toBe(DEFAULT_TUNING.mettik.HP);
    expect(v.cannon.DAMAGE).toBe(1);
  });
});

describe('filter', () => {
  it('matches every word against the group, the key and the folder title, ignoring case', () => {
    expect(matchesFilter('', 'mettik', 'HP', 'Mettik')).toBe(true);
    expect(matchesFilter('recovery', 'canodron', 'RECOVERY_TIME', 'Canodron')).toBe(true);
    expect(matchesFilter('cano recov', 'canodron', 'RECOVERY_TIME', 'Canodron')).toBe(true);
    expect(matchesFilter('mettik.hp', 'mettik', 'HP', 'Mettik')).toBe(true);
    expect(matchesFilter('cano hp', 'mettik', 'HP', 'Mettik')).toBe(false);
    expect(matchesFilter('wide', 'widesword', 'DAMAGE', 'WideSword')).toBe(true);
  });
});

describe('controls', () => {
  it('classifies hexadecimal tuning strings as colour controls', () => {
    expect(tuningControlKind('#77C8DF')).toBe('color');
    expect(tuningControlKind('hologram')).toBe('string');
    expect(tuningControlKind(0.46)).toBe('number');
    expect(tuningControlKind(true)).toBe('boolean');
  });

  it('uses listed slider ranges and a positive auto range otherwise', () => {
    expect(sliderRange('WORLD_TIME_SCALE', 0.85)).toEqual([0.1, 1, 0.05]);
    expect(sliderRange('ACTION_DELAY', 0.4)).toEqual([0, 1.6, 0.01]);
    expect(sliderRange('HP', 4)).toEqual([0, 16, 1]);
    expect(sliderRange('OFF', 0)).toEqual([0, 10, 0.01]);
  });
});
