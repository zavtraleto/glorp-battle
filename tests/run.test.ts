import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, tuning } from '../src/config/tuning';
import { PLAY_CONTENT, Run, RUN_STEPS } from '../src/app/run';
import type { EnemyKind } from '../src/sim/enemies/enemyBase';

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

const kinds = (run: Run) => run.encounter.enemies.map((enemy) => enemy.kind);

describe('Run', () => {
  it('uses the eight-stage Play progression', () => {
    const run = new Run(5, 'basic');
    const expected = [
      ['mettik'],
      ['canodron', 'canodron'],
      ['mettik', 'canodron'],
      ['bladdy'],
      ['bladdy', 'canodron'],
      ['hopzap'],
      ['mettik', 'hopzap'],
    ];

    expect(RUN_STEPS).toBe(8);
    for (const want of expected) {
      expect(kinds(run)).toEqual(want);
      run.finishBattle(true, run.hp);
    }

    const finalKinds = kinds(run);
    const allowed = new Set<EnemyKind>(PLAY_CONTENT.enemies);
    expect(finalKinds).toHaveLength(3);
    expect(new Set(finalKinds).size).toBe(3);
    expect(finalKinds.every((kind) => allowed.has(kind))).toBe(true);
  });

  it('reproduces the final random trio from the run seed', () => {
    const a = new Run(123, 'basic');
    const b = new Run(123, 'field');
    a.jumpTo(8);
    b.jumpTo(8);
    expect(kinds(a)).toEqual(kinds(b));
  });

  it('starts with the 20-card Play folder regardless of the legacy menu choice', () => {
    const basic = new Run(1, 'basic').folder;
    const random = new Run(1, 'random').folder;
    expect(basic).toHaveLength(20);
    expect(random).toEqual(basic);
  });

  it('carries HP without automatic healing', () => {
    const run = new Run(1, 'basic');
    for (const hp of [4, 3, 2, 1]) {
      run.finishBattle(true, hp);
      expect(run.hp).toBe(hp);
      expect(run.healed).toBe(false);
    }
  });

  it('completes after the eighth win', () => {
    const run = new Run(1, 'basic');
    for (let step = 1; step < RUN_STEPS; step++) {
      run.finishBattle(true, run.hp);
      expect(run.complete).toBe(false);
    }
    run.finishBattle(true, run.hp);
    expect(run.complete).toBe(true);
    expect(run.history).toHaveLength(8);
  });

  it('a loss ends the climb without advancing the step', () => {
    const run = new Run(3, 'basic');
    run.finishBattle(true, 6);
    expect(run.hp).toBe(6);
    expect(run.depth).toBe(2);
    expect(run.folder).toHaveLength(20);
    run.finishBattle(false, 0);
    expect(run.depth).toBe(2);
    expect(run.history.map((step) => step.won)).toEqual([true, false]);
    expect(run.complete).toBe(false);
  });

  it('jumpTo selects the requested Play stage', () => {
    const run = new Run(1, 'basic');
    run.jumpTo(RUN_STEPS);
    expect(run.depth).toBe(RUN_STEPS);
    expect(kinds(run)).toHaveLength(3);
    run.jumpTo(1);
    expect(run.depth).toBe(1);
    expect(kinds(run)).toEqual(['mettik']);
  });
});
