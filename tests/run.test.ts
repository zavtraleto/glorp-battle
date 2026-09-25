import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, tuning } from '../src/config/tuning';
import { PLAY_ENEMIES, Run, RUN_STEPS } from '../src/app/run';
import type { EnemyKind } from '../src/sim/enemies/enemyBase';
import { folderChips } from '../src/sim/chips/chipSystem';

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

/** Enemy kinds wave by wave. */
const waves = (run: Run) => run.encounter.waves.map((w) => w.enemies.map((enemy) => enemy.kind));

describe('Run', () => {
  it('uses the six-stage Play progression, two or three waves each (GDD §10.2)', () => {
    const run = new Run(5);
    expect(RUN_STEPS).toBe(6);
    // Stage 1 is fixed by the design: Mettik, two Mettiks, Mettik + Canodron.
    expect(waves(run)).toEqual([['mettik'], ['mettik', 'mettik'], ['mettik', 'canodron']]);
    const allowed = new Set<EnemyKind>(PLAY_ENEMIES);
    for (let step = 1; step <= RUN_STEPS; step++) {
      const w = waves(run);
      expect(w.length, `stage ${step}`).toBeGreaterThanOrEqual(2);
      expect(w.length, `stage ${step}`).toBeLessThanOrEqual(3);
      for (const kinds of w) {
        expect(kinds.length).toBeGreaterThan(0);
        expect(kinds.length).toBeLessThanOrEqual(3);
        expect(kinds.every((kind) => allowed.has(kind))).toBe(true);
      }
      run.finishBattle(true, run.hp);
    }
  });

  it('reproduces the final random waves from the run seed', () => {
    const a = new Run(123);
    const b = new Run(123);
    a.jumpTo(RUN_STEPS);
    b.jumpTo(RUN_STEPS);
    expect(waves(a)).toEqual(waves(b));
    for (const kinds of waves(a)) expect(new Set(kinds).size).toBe(kinds.length);
  });

  it('starts with the 14-chip starter folder without Mine (GDD §6.3)', () => {
    const folder = new Run(1).folder;
    const counts = new Map<string, number>();
    for (const chip of folder) counts.set(chip.defId, (counts.get(chip.defId) ?? 0) + 1);
    expect(folder).toHaveLength(14);
    expect(Object.fromEntries(counts)).toEqual({
      cannon: 3, sword: 2, widesword: 1, airshot: 2, spreader: 1, areagrab: 2, guard: 1, block: 1, break: 1,
    });
    expect(new Run(2).folder).toEqual(folder);
  });

  it('carries HP without automatic healing', () => {
    const run = new Run(1);
    for (const hp of [4, 3, 2, 1]) {
      run.finishBattle(true, hp);
      expect(run.hp).toBe(hp);
    }
  });

  it('completes after the last win', () => {
    const run = new Run(1);
    for (let step = 1; step < RUN_STEPS; step++) {
      run.finishBattle(true, run.hp);
      expect(run.complete).toBe(false);
    }
    run.finishBattle(true, run.hp);
    expect(run.complete).toBe(true);
    expect(run.history).toHaveLength(RUN_STEPS);
  });

  it('a loss ends the climb without advancing the step', () => {
    const run = new Run(3);
    run.finishBattle(true, 6);
    expect(run.hp).toBe(6);
    expect(run.depth).toBe(2);
    expect(run.folder).toHaveLength(folderChips('starter').length);
    run.finishBattle(false, 0);
    expect(run.depth).toBe(2);
    expect(run.history.map((step) => step.won)).toEqual([true, false]);
    expect(run.complete).toBe(false);
  });

  it('jumpTo selects the requested Play stage', () => {
    const run = new Run(1);
    run.jumpTo(RUN_STEPS);
    expect(run.depth).toBe(RUN_STEPS);
    expect(waves(run)).toHaveLength(3);
    run.jumpTo(1);
    expect(run.depth).toBe(1);
    expect(waves(run)[0]).toEqual(['mettik']);
  });
});
