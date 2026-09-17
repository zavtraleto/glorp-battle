import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { Command } from '../src/core/input/commands';
import { Rng } from '../src/core/rng';
import { FOLDERS, FOLDER_SIZE } from '../src/data/folders';
import { ChipSystem } from '../src/sim/chips/chipSystem';
import { isValidSelection, type ChipKey } from '../src/sim/chips/selection';
import { Mettik } from '../src/sim/enemies/mettik';
import { World } from '../src/sim/world';

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);

beforeEach(() => {
  mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING)));
});

const k = (defId: ChipKey['defId'], code: ChipKey['code']): ChipKey => ({ defId, code });

describe('folders', () => {
  it('contain exactly 30 chips', () => {
    for (const folder of Object.values(FOLDERS)) {
      expect(folder.reduce((n, e) => n + e.count, 0)).toBe(FOLDER_SIZE);
    }
  });
});

describe('selection rule', () => {
  it('accepts same name with different codes', () => {
    expect(isValidSelection([k('cannon', 'A'), k('cannon', 'B'), k('cannon', 'C')])).toBe(true);
  });

  it('accepts same code with different names', () => {
    expect(isValidSelection([k('cannon', 'A'), k('recover50', 'A')])).toBe(true);
    expect(isValidSelection([k('sword', 'S'), k('widesword', 'S'), k('longsword', 'S')])).toBe(true);
  });

  it('does not mix the two rules', () => {
    expect(isValidSelection([k('cannon', 'A'), k('cannon', 'F'), k('recover50', 'A')])).toBe(false);
    expect(isValidSelection([k('cannon', 'A'), k('sword', 'S')])).toBe(false);
  });

  it('treats * as a wildcard code', () => {
    expect(isValidSelection([k('cannon', '*'), k('sword', 'S')])).toBe(true);
    expect(isValidSelection([k('cannon', 'A'), k('sword', '*'), k('recover50', 'A')])).toBe(true);
    expect(isValidSelection([k('cannon', 'A'), k('sword', '*'), k('widesword', 'S')])).toBe(false);
  });
});

describe('ChipSystem', () => {
  const make = (seed = 3) => new ChipSystem('mvp', new Rng(seed));

  it('shuffles deterministically per seed', () => {
    const a = make(11);
    const b = make(11);
    const c = make(12);
    a.openTurn();
    b.openTurn();
    c.openTurn();
    const uids = (s: ChipSystem) => s.hand.map((x) => x?.uid);
    expect(uids(a)).toEqual(uids(b));
    expect(uids(a)).not.toEqual(uids(c));
  });

  it('draws a hand of 5', () => {
    const s = make();
    s.openTurn();
    expect(s.hand).toHaveLength(5);
    expect(s.hand.every((c) => c?.state === 'hand')).toBe(true);
    expect(s.folderRemaining).toBe(25);
  });

  it('enforces the 5-chip limit and compatibility when selecting', () => {
    const s = make();
    s.openTurn();
    // Force a hand of five Cannon A.
    const cannons = s.chips.filter((c) => c.defId === 'cannon').slice(0, 5);
    s.hand = cannons;
    for (let i = 0; i < 5; i++) expect(s.select(i)).toBe(true);
    expect(s.selection).toEqual([0, 1, 2, 3, 4]);
    expect(s.select(0)).toBe(false);

    const t2 = make();
    t2.openTurn();
    const cannon = t2.chips.find((c) => c.defId === 'cannon')!;
    const sword = t2.chips.find((c) => c.defId === 'sword')!;
    const recover = t2.chips.find((c) => c.defId === 'recover50')!;
    t2.hand = [cannon, sword, recover, null, null];
    expect(t2.select(0)).toBe(true);
    expect(t2.canSelect(1)).toBe(false);
    expect(t2.canSelect(2)).toBe(true);
    expect(t2.canSelect(3)).toBe(false); // empty slot
  });

  it('cancel removes only the last selected chip', () => {
    const s = make();
    s.openTurn();
    s.hand = s.chips.filter((c) => c.defId === 'cannon').slice(0, 5);
    s.select(2);
    s.select(0);
    s.cancelLast();
    expect(s.selection).toEqual([2]);
  });

  it('confirm queues chips in selection order and keeps the rest of the hand in place', () => {
    const s = make();
    s.openTurn();
    s.hand = s.chips.filter((c) => c.defId === 'cannon').slice(0, 5);
    for (const c of s.hand) c!.state = 'hand';
    const [c0, c1, c2, c3, c4] = s.hand;
    s.select(3);
    s.select(1);
    s.confirm();
    expect(s.queue).toEqual([c3, c1]);
    expect(s.queue.every((c) => c.state === 'queued')).toBe(true);
    expect(s.hand).toEqual([c0, null, c2, null, c4]);

    s.openTurn();
    // Kept chips stay in their slots; holes are refilled from the folder.
    expect(s.hand[0]).toBe(c0);
    expect(s.hand[2]).toBe(c2);
    expect(s.hand[4]).toBe(c4);
    expect(s.hand[1]).not.toBeNull();
    expect(s.hand[3]).not.toBeNull();
  });

  it('unused queued chips burn when the Custom Screen reopens', () => {
    const s = make();
    s.openTurn();
    s.select(0);
    s.confirm();
    const queued = s.queue[0]!;
    s.openTurn();
    expect(queued.state).toBe('used');
    expect(s.queue).toHaveLength(0);
    expect(s.hand).not.toContain(queued);
  });

  it('used chips never come back and the folder runs dry', () => {
    const s = make();
    const seen = new Set<number>();
    for (let turn = 0; turn < 12; turn++) {
      s.openTurn();
      s.hand.forEach((c, i) => {
        if (c && s.canSelect(i)) s.select(i);
      });
      for (const c of s.selectedChips()) {
        expect(seen.has(c.uid)).toBe(false);
        seen.add(c.uid);
      }
      s.confirm();
      while (s.takeNext());
    }
    expect(s.folderRemaining).toBe(0);
    s.openTurn();
    expect(s.hand.length).toBe(5);
    expect(s.count('used') + s.hand.filter(Boolean).length).toBe(30);
  });

  it('ADD grows the next hand to 10 then 15 and resets after picking chips', () => {
    const s = make();
    s.openTurn();
    s.select(0);
    s.add();
    expect(s.queue).toHaveLength(0);
    expect(s.selection).toHaveLength(0);
    s.openTurn();
    expect(s.hand).toHaveLength(10);
    expect(s.hand.every(Boolean)).toBe(true);
    s.add();
    s.openTurn();
    expect(s.hand).toHaveLength(15);
    s.add();
    s.openTurn();
    expect(s.hand).toHaveLength(15);

    // Picking a chip resets the size; kept chips are never discarded.
    s.select(s.hand.findIndex((_, i) => s.canSelect(i)));
    s.confirm();
    expect(s.addStreak).toBe(0);
    s.openTurn();
    expect(s.hand).toHaveLength(14);
    expect(s.hand.every(Boolean)).toBe(true);
  });

  it('an empty OK keeps the ADD bonus', () => {
    const s = make();
    s.openTurn();
    s.add();
    s.openTurn();
    s.confirm();
    expect(s.addStreak).toBe(1);
  });
});

function step(w: World, commands: Command[] = []): void {
  w.step(DT, { commands, held: null });
}
function run(w: World, n: number): void {
  for (let i = 0; i < n; i++) step(w);
}

describe('battle flow and gauge', () => {
  it('intro → Custom Screen → BATTLE START → ACTION', () => {
    const w = new World({ seed: 1, battleIndex: 1 });
    expect(w.state).toBe('BATTLE_INTRO');
    run(w, T(tuning.fx.INTRO_TIME));
    expect(w.state).toBe('CUSTOM');
    expect(w.chips.hand).toHaveLength(5);
    w.customSelect(0);
    w.customConfirm();
    expect(w.state).toBe('BATTLE_START');
    expect(w.firstStart).toBe(true);
    expect(w.chips.queue).toHaveLength(1);
    run(w, T(tuning.fx.BANNER_BATTLE_START));
    expect(w.state).toBe('ACTION');
    expect(w.tick).toBe(0);
  });

  it('the battle is frozen outside ACTION', () => {
    const w = new World({ seed: 1, battleIndex: 1 });
    run(w, 300);
    const m = w.enemies[0] as Mettik;
    expect(w.state).toBe('CUSTOM');
    expect(w.tick).toBe(0);
    expect(m.state).toBe('IDLE');
    expect(w.gauge.value).toBe(0);
  });

  it('the gauge fills in GAUGE_FILL_TIME and stays full', () => {
    const w = new World({ seed: 1, battleIndex: 1, skipIntro: true, cheats: { god: true, aiEnabled: false } });
    run(w, T(tuning.gauge.GAUGE_FILL_TIME) - 1);
    expect(w.gauge.full).toBe(false);
    run(w, 1);
    expect(w.gauge.full).toBe(true);
    run(w, 100);
    expect(w.gauge.value).toBe(1);
  });

  it('OPEN CUSTOM does nothing until the gauge is full', () => {
    const w = new World({ seed: 1, battleIndex: 1, skipIntro: true, cheats: { god: true, aiEnabled: false } });
    step(w, [{ type: 'openCustom' }]);
    run(w, 5);
    expect(w.state).toBe('ACTION');
    w.fillGauge();
    step(w, [{ type: 'openCustom' }]);
    expect(w.state).toBe('CUSTOM');
  });

  it('opening while flinched waits until the flinch ends', () => {
    const w = new World({ seed: 1, battleIndex: 1, skipIntro: true, cheats: { god: true, aiEnabled: false } });
    w.fillGauge();
    w.player.takeHit(0, w.tick);
    step(w, [{ type: 'openCustom' }]);
    expect(w.state).toBe('ACTION');
    run(w, T(tuning.player.PLAYER_FLINCH_TIME));
    expect(w.state).toBe('CUSTOM');
  });

  it('the second Custom Screen resets the gauge and resumes without the banner', () => {
    const w = new World({ seed: 1, battleIndex: 1, skipIntro: true, cheats: { god: true, aiEnabled: false } });
    w.fillGauge();
    step(w, [{ type: 'move', dir: 'left' }, { type: 'openCustom' }]);
    expect(w.state).toBe('CUSTOM');
    expect(w.player.bufferedDir).toBeNull();
    w.customConfirm();
    expect(w.firstStart).toBe(false);
    expect(w.gauge.value).toBe(0);
    run(w, T(tuning.fx.RESUME_DELAY));
    expect(w.state).toBe('ACTION');
  });

  it('ADD from the world leaves with an empty queue', () => {
    const w = new World({ seed: 1, battleIndex: 1 });
    run(w, T(tuning.fx.INTRO_TIME));
    w.customSelect(0);
    w.customAdd();
    expect(w.chips.queue).toHaveLength(0);
    expect(w.state).toBe('BATTLE_START');
  });
});
