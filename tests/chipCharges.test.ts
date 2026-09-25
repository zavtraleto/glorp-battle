import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { Command } from '../src/core/input/commands';
import { Rng } from '../src/core/rng';
import { CHIPS, type ChipId } from '../src/data/chips';
import { e, wave, type Encounter } from '../src/data/encounters';
import { ChipSystem, type ChipInstance, type FolderChip } from '../src/sim/chips/chipSystem';
import { World } from '../src/sim/world';

// Chip charges per battle (GDD §5, §6.1, §7.5): every use of a copy spends one
// charge, a copy at zero leaves the folder until the battle ends.

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

const chip = (defId: ChipId): FolderChip => ({ defId });

/** Fires the chip in `slot` and resolves it, as World does at its hit frame. */
function fire(s: ChipSystem, slot: number): ChipInstance {
  s.toggleSelect(slot);
  s.startAttack(0);
  const c = s.takeNext(0) as ChipInstance;
  s.spendCharge(c);
  s.finishAttack();
  return c;
}

const TWO_WAVES: Encounter = {
  id: 'charges', tier: 'normal', minDepth: 1, maxDepth: 1,
  waves: [wave(e('mettik', 1, 1)), wave(e('mettik', 1, 1))],
};

function world(folder: FolderChip[], god = true): World {
  const w = new World({
    seed: 3, battleIndex: 1, encounter: TWO_WAVES, folder, skipIntro: true,
    cheats: { god, aiEnabled: false },
  });
  for (const enemy of w.enemies) enemy.hp = 100_000;
  return w;
}

function step(w: World, commands: Command[] = []): void {
  w.step(DT, { commands, held: null });
}

function run(w: World, n: number): void {
  for (let i = 0; i < n; i++) step(w);
}

/** Selects and fires the chip in `slot`, then waits for it and the hand cooldown. */
function shoot(w: World, slot: number): void {
  step(w, [{ type: 'selectChip', slot }, { type: 'useChip' }]);
  run(w, T(tuning.chips.HAND_REFILL_COOLDOWN) + T(1));
}

describe('chip charges', () => {
  it('reads the starting charges from the chip data', () => {
    expect(CHIPS.cannon.charges).toBe(tuning.chips.CHIP_CHARGES_ATTACK);
    expect(CHIPS.sword.charges).toBe(tuning.chips.CHIP_CHARGES_ATTACK);
    expect(CHIPS.areagrab.charges).toBe(tuning.chips.CHIP_CHARGES_SUPPORT);
    expect(CHIPS.guard.charges).toBe(tuning.chips.CHIP_CHARGES_SUPPORT);
    tuning.chips.CHIP_CHARGES_ATTACK = 4;
    const s = new ChipSystem([chip('cannon')], new Rng(1));
    expect(s.chips[0]).toMatchObject({ charges: 4, maxCharges: 4 });
  });

  it('spends one charge per use and keeps a copy with charges in the rotation', () => {
    const s = new ChipSystem([chip('cannon')], new Rng(1));
    s.dealHand();
    const c = fire(s, 0);
    expect(c.charges).toBe(tuning.chips.CHIP_CHARGES_ATTACK - 1);
    expect(c.state).toBe('used');
    s.refillReady(T(tuning.chips.HAND_REFILL_COOLDOWN));
    expect(s.hand[0]?.uid).toBe(c.uid);
  });

  it('takes a copy out of the folder at zero charges', () => {
    // Six copies for a hand of five: the refill has a real draw left.
    const s = new ChipSystem([chip('guard'), ...Array.from({ length: 5 }, () => chip('cannon'))], new Rng(1));
    s.dealHand();
    const slot = s.hand.findIndex((c) => c?.defId === 'guard');
    const guard = fire(s, slot);
    expect(guard.charges).toBe(0);
    expect(guard.state).toBe('exhausted');
    s.refillReady(T(tuning.chips.HAND_REFILL_COOLDOWN));
    expect(s.hand.some((c) => c?.uid === guard.uid)).toBe(false);
    expect(s.count('exhausted')).toBe(1);
  });

  it('TEMP until T3: an empty folder refills every exhausted copy', () => {
    const s = new ChipSystem([chip('guard')], new Rng(1));
    s.dealHand();
    const guard = fire(s, 0);
    expect(guard.state).toBe('exhausted');
    s.refillReady(T(tuning.chips.HAND_REFILL_COOLDOWN));
    expect(s.hand[0]?.uid).toBe(guard.uid);
    expect(guard.charges).toBe(guard.maxCharges);
    expect(s.reshuffles).toBe(1);
  });

  it('spends a charge only when the chip resolves, not when it is interrupted', () => {
    const w = world([chip('cannon')], false);
    const c = w.chips.hand[0] as ChipInstance;
    step(w, [{ type: 'selectChip', slot: 0 }, { type: 'useChip' }]);
    // A hit before the hit frame sends the chip back to its slot.
    w.resolveHit({ target: w.player, damage: 1 });
    expect(w.chips.hand[0]?.uid).toBe(c.uid);
    expect(c.charges).toBe(c.maxCharges);
  });

  it('keeps spent charges through the waves of one battle', () => {
    const w = world([chip('cannon')]);
    const c = w.chips.hand[0] as ChipInstance;
    shoot(w, 0);
    expect(c.charges).toBe(c.maxCharges - 1);
    w.killAllEnemies();
    run(w, T(tuning.wave.CLEAR_TIME) + T(tuning.wave.FLIGHT_TIME) + T(tuning.wave.SPAWN_TIME) + 2);
    expect(w.state).toBe('ACTION');
    expect(w.waveIndex).toBe(1);
    expect(c.charges).toBe(c.maxCharges - 1);
  });

  it('starts every battle with full charges', () => {
    const folder = [chip('cannon')];
    const first = world(folder);
    shoot(first, 0);
    expect(first.chips.chips[0]?.charges).toBe(tuning.chips.CHIP_CHARGES_ATTACK - 1);
    const next = world(folder);
    expect(next.chips.chips[0]?.charges).toBe(tuning.chips.CHIP_CHARGES_ATTACK);
  });

  it('reports the last charge with the cartridge deal, and only the last', () => {
    const w = world([chip('cannon')]);
    const c = w.chips.hand[0] as ChipInstance;
    const exhausted = () => w.drainEvents().filter((ev) => ev.type === 'chipExhausted');
    const deal = c.deal;
    step(w, [{ type: 'selectChip', slot: 0 }, { type: 'useChip' }]);
    run(w, T(1));
    expect(exhausted()).toEqual([]);
    run(w, T(tuning.chips.HAND_REFILL_COOLDOWN));
    const second = c.deal;
    expect(second).not.toBe(deal);
    step(w, [{ type: 'selectChip', slot: 0 }, { type: 'useChip' }]);
    run(w, T(1));
    expect(exhausted()).toEqual([{ type: 'chipExhausted', defId: 'cannon', deal: second }]);
  });

  it('does not report an interrupted last charge', () => {
    const w = world([chip('guard'), chip('cannon')], false);
    const slot = w.chips.hand.findIndex((c) => c?.defId === 'guard');
    w.drainEvents();
    step(w, [{ type: 'selectChip', slot }, { type: 'useChip' }]);
    w.resolveHit({ target: w.player, damage: 1 });
    expect(w.chips.hand[slot]?.defId).toBe('guard');
    run(w, T(0.5));
    expect(w.drainEvents().some((ev) => ev.type === 'chipExhausted')).toBe(false);
  });

  it('never stalls: the battle keeps dealing chips after every charge is spent', () => {
    const w = world([chip('guard'), chip('areagrab')]);
    for (let i = 0; i < 6; i++) {
      const slot = w.chips.hand.findIndex((c, j) => c !== null && w.chips.canSelect(j));
      expect(slot).toBeGreaterThanOrEqual(0);
      shoot(w, slot);
    }
  });
});
