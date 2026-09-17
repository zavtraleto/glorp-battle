import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, tuning } from '../src/config/tuning';
import { clearLegacy, LEGACY_KEY, loadLegacy, saveLegacy, type LegacyStorage } from '../src/app/legacyStore';
import { ELITE_FROM, Run, RUN_STEPS } from '../src/app/run';
import { CHIPS } from '../src/data/chips';
import { STARTER_FOLDER } from '../src/data/starterFolder';
import { ChipSystem } from '../src/sim/chips/chipSystem';
import { Rng } from '../src/core/rng';

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

/** Plays a run to the end, always taking the first option and winning. */
function playThrough(run: Run): string[] {
  const kinds: string[] = [];
  for (let i = 0; i < RUN_STEPS; i++) {
    const o = run.choose(0);
    kinds.push(o.kind);
    run.finishBattle(true, run.hp);
  }
  return kinds;
}

class MemoryStorage implements LegacyStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

describe('Run', () => {
  it('is deterministic for a seed', () => {
    const a = new Run(42, 1, null);
    const b = new Run(42, 1, null);
    const ids = (r: Run) => r.options.map((o) => o.encounter.id);
    expect(ids(a)).toEqual(ids(b));
    a.choose(0);
    b.choose(0);
    expect(a.rewardChoices()).toEqual(b.rewardChoices());
  });

  it('has ten steps with 2–3 options, no early elites, and a boss at the end', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const run = new Run(seed, 1, null);
      for (let depth = 1; depth < RUN_STEPS; depth++) {
        expect(run.options.length).toBeGreaterThanOrEqual(2);
        expect(run.options.length).toBeLessThanOrEqual(3);
        if (depth < ELITE_FROM) expect(run.options.every((o) => o.kind === 'normal')).toBe(true);
        const ids = run.options.map((o) => o.encounter.id);
        expect(new Set(ids).size).toBe(ids.length);
        run.choose(0);
        run.finishBattle(true, run.hp);
      }
      expect(run.options.map((o) => o.kind)).toEqual(['boss']);
      run.choose(0);
      run.finishBattle(true, run.hp);
      expect(run.complete).toBe(true);
    }
  });

  it('does not repeat encounters it has already played when others fit', () => {
    const run = new Run(9, 1, null);
    const kinds = playThrough(run);
    expect(kinds[kinds.length - 1]).toBe('boss');
    const ids = run.history.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('starts from the starter folder plus the legacy chip', () => {
    expect(new Run(1, 1, null).folder).toHaveLength(STARTER_FOLDER.length);
    expect(STARTER_FOLDER).toHaveLength(18);
    const run = new Run(1, 8, { defId: 'mcannon', code: 'K', gen: 7 });
    expect(run.folder).toHaveLength(19);
    expect(run.folder[18]).toEqual({ defId: 'mcannon', code: 'K', legacyGen: 7 });
    const chips = new ChipSystem(run.folder, new Rng(1));
    expect(chips.chips.find((c) => c.defId === 'mcannon')?.legacyGen).toBe(7);
  });

  it('offers three different chips with valid codes; elite rewards lead with a rare find', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const run = new Run(seed, 1, null);
      run.choose(0);
      const r = run.rewardChoices();
      expect(r).toHaveLength(3);
      expect(new Set(r.map((c) => c.defId)).size).toBe(3);
      for (const c of r) expect(CHIPS[c.defId].codes).toContain(c.code);
      run.jumpTo(5);
      run.current = { kind: 'elite', encounter: run.options[0]!.encounter };
      expect(CHIPS[run.rewardChoices()[0]!.defId].rarity).not.toBe('common');
    }
  });

  it('carries HP and grows the folder; a loss ends the climb', () => {
    const run = new Run(3, 1, null);
    run.choose(0);
    run.finishBattle(true, 64);
    expect(run.hp).toBe(64);
    expect(run.depth).toBe(2);
    run.addChip({ defId: 'spreader', code: 'M' });
    expect(run.folder).toHaveLength(19);
    run.choose(1);
    run.finishBattle(false, 0);
    expect(run.depth).toBe(2);
    expect(run.history.map((s) => s.won)).toEqual([true, false]);
  });
});

describe('legacy store', () => {
  it('saves and loads the generation and the chip', () => {
    const s = new MemoryStorage();
    expect(loadLegacy(s)).toEqual({ generation: 1, chip: null });
    saveLegacy({ generation: 7, chip: { defId: 'steal', code: 'S', gen: 6 } }, s);
    expect(loadLegacy(s)).toEqual({ generation: 7, chip: { defId: 'steal', code: 'S', gen: 6 } });
    clearLegacy(s);
    expect(loadLegacy(s).generation).toBe(1);
  });

  it('survives broken data and a missing store', () => {
    const s = new MemoryStorage();
    s.setItem(LEGACY_KEY, '{nope');
    expect(loadLegacy(s)).toEqual({ generation: 1, chip: null });
    s.setItem(LEGACY_KEY, JSON.stringify({ generation: 3, chip: { defId: 'nochip', code: 'A', gen: 1 } }));
    expect(loadLegacy(s)).toEqual({ generation: 3, chip: null });
    expect(loadLegacy(null)).toEqual({ generation: 1, chip: null });
    expect(() => saveLegacy({ generation: 2, chip: null }, null)).not.toThrow();
  });
});
