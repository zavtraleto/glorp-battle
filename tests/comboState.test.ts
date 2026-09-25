import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { ChipId } from '../src/data/chips';
import { chipTiming } from '../src/sim/chips/executor';
import { CHIPS } from '../src/data/chips';
import { Shockwave } from '../src/sim/attacks/shockwave';
import { World } from '../src/sim/world';

const DT = 1 / 60;
const T = (seconds: number) => secondsToTicks(seconds);
let uid = 50_000;

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

function world(god = false): World {
  const w = new World({ seed: 17, battleIndex: 1, skipIntro: true, cheats: { god, aiEnabled: false } });
  for (const enemy of w.enemies) enemy.hp = 10_000;
  return w;
}

function give(w: World, ...ids: ChipId[]): number[] {
  const before = new Set(w.chips.attack);
  for (const defId of ids) w.giveChip({ uid: uid++, defId, state: 'queued', deal: 0 });
  return w.chips.attack.filter((slot) => !before.has(slot));
}

function step(w: World, use = false): void {
  w.step(DT, { commands: use ? [{ type: 'useChip' }] : [], held: null });
}

function run(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(w);
}

describe('Combo State activation and completion', () => {
  it('never activates for one chip and keeps the existing immediate cooldown', () => {
    const w = world();
    give(w, 'cannon');
    step(w, true);

    expect(w.combo).toBeNull();
    expect(w.chips.handCooldownProgress(w.playerTick)).toBe(0);
  });

  it('starts only after the first chip of a two-chip chain begins', () => {
    const w = world();
    give(w, 'cannon', 'sword');
    expect(w.combo).toBeNull();
    expect(w.chips.handCooldownProgress(w.playerTick)).toBeNull();

    step(w, true);

    expect(w.combo?.status).toBe('active');
    expect(w.combo?.startedAt).toBe(w.playerTick);
    expect(w.chips.handCooldownProgress(w.playerTick)).toBeNull();
    expect(w.worldTimeScale).toBe(1);
  });

  it('does not start when the first use is refused', () => {
    const w = world();
    give(w, 'cannon', 'sword');
    w.player.paralyzeTicks = 2;

    step(w, true);

    expect(w.combo).toBeNull();
    expect(w.chips.attack).toHaveLength(2);
    expect(w.chipsUsed).toBe(0);
  });

  it('finishes after the last recovery and starts cooldown on that tick', () => {
    const w = world();
    give(w, 'cannon', 'sword');
    step(w, true);
    run(w, chipTiming(CHIPS.cannon).totalTicks);
    step(w, true);
    expect(w.activeChip?.def.id).toBe('sword');
    expect(w.combo).not.toBeNull();

    run(w, chipTiming(CHIPS.sword).totalTicks);

    expect(w.combo).toBeNull();
    expect(w.activeChip).toBeNull();
    expect(w.chips.handCooldownProgress(w.playerTick)).toBe(0);
  });
});

describe('Combo State without a time limit', () => {
  it('keeps the queued tail and slow motion active until the player uses the last chip', () => {
    const w = world();
    const [, secondSlot] = give(w, 'cannon', 'sword');
    step(w, true);
    run(w, T(10));

    expect(w.activeChip).toBeNull();
    expect(w.combo?.status).toBe('active');
    expect(w.comboDisplayActive).toBe(true);
    expect(w.chips.hand[secondSlot!]?.defId).toBe('sword');
    expect(w.chips.handCooldownProgress(w.playerTick)).toBeNull();

    step(w, true);
    run(w, chipTiming(CHIPS.sword).totalTicks);
    expect(w.combo).toBeNull();
    expect(w.chips.handCooldownProgress(w.playerTick)).toBe(0);
  });
});

describe('Combo State manual execution', () => {
  it('accepts the next press just before recovery ends through the input buffer', () => {
    const w = world();
    give(w, 'cannon', 'sword');
    step(w, true);
    run(w, chipTiming(CHIPS.cannon).totalTicks - 2);

    step(w, true);
    expect(w.activeChip?.def.id).toBe('cannon');
    step(w);
    expect(w.activeChip?.def.id).toBe('sword');
  });

  it('consumes a deliberate miss and permits the following chip', () => {
    const w = world();
    give(w, 'sword', 'cannon');
    step(w, true);
    run(w, chipTiming(CHIPS.sword).totalTicks);

    step(w, true);
    expect(w.chipsUsed).toBe(2);
    expect(w.activeChip?.def.id).toBe('cannon');
  });

  it('supports a five-chip chain without auto-firing any chip', () => {
    const w = world();
    give(w, 'cannon', 'sword', 'mine', 'block', 'guard');
    step(w, true);

    expect(w.combo?.status).toBe('active');
    expect(w.chips.attack).toHaveLength(4);
    expect(w.chipsUsed).toBe(1);
  });

  it('lets the player move at normal cadence between manual chip uses', () => {
    const w = world();
    give(w, 'cannon', 'sword');
    step(w, true);
    run(w, chipTiming(CHIPS.cannon).totalTicks);
    const from = w.player.y;

    w.step(DT, { commands: [{ type: 'move', dir: 'up' }], held: null });

    expect(w.player.y).toBe(from - 1);
    expect(w.combo?.status).toBe('active');
    expect(w.chipsUsed).toBe(1);
  });

  it('does not create Combo State for a debug chain longer than five', () => {
    tuning.chips.HAND_SIZE = 6;
    const w = world();
    give(w, 'cannon', 'sword', 'mine', 'block', 'break', 'guard');

    step(w, true);

    expect(w.combo).toBeNull();
    expect(w.chips.handCooldownProgress(w.playerTick)).toBe(0);
  });
});

describe('Combo State slow-motion transitions', () => {
  it('eases into world slow motion and exits after the last action', () => {
    const w = world();
    give(w, 'cannon', 'sword');
    step(w, true);
    run(w, T(tuning.combo.SLOW_MO_ENTER));
    expect(w.worldTimeScale).toBeCloseTo(tuning.combo.WORLD_TIME_SCALE, 6);

    run(w, w.activeChip!.endTick - w.playerTick);
    step(w, true);
    run(w, w.activeChip!.endTick - w.playerTick);
    expect(w.combo).toBeNull();
    expect(w.worldTimeScale).toBeCloseTo(tuning.combo.WORLD_TIME_SCALE, 6);

    run(w, T(tuning.combo.SLOW_MO_EXIT));
    expect(w.worldTimeScale).toBe(1);
  });

  it('uses the fast exit and immediately turns off the display after Combo Break', () => {
    const w = world();
    give(w, 'cannon', 'sword');
    step(w, true);
    run(w, T(tuning.combo.SLOW_MO_ENTER));

    w.resolveHit({ target: w.player, damage: 1 });
    expect(w.comboDisplayActive).toBe(false);
    run(w, T(tuning.combo.COMBO_BREAK_EXIT));

    expect(w.worldTimeScale).toBe(1);
    expect(w.comboDisplayActive).toBe(false);
  });
});

describe('Combo Break', () => {
  it('breaks only on actual HP loss, restores an unresolved active chip, and burns the tail', () => {
    const w = world();
    const [firstSlot, secondSlot] = give(w, 'cannon', 'sword');
    step(w, true);
    const hp = w.player.hp;

    w.resolveHit({ target: w.player, damage: 1 });

    expect(w.player.hp).toBe(hp - 1);
    expect(w.combo).toBeNull();
    expect(w.activeChip).toBeNull();
    expect(w.chips.hand[firstSlot!]?.defId).toBe('cannon');
    expect(w.chips.hand[secondSlot!]).toBeNull();
    expect(w.chips.handCooldownProgress(w.playerTick)).toBe(0);
  });

  it('does not break or interrupt when Guard prevents HP loss', () => {
    const w = world();
    give(w, 'cannon', 'sword');
    step(w, true);
    w.player.guard = true;

    w.resolveHit({ target: w.player, damage: 1 });

    expect(w.combo?.status).toBe('active');
    expect(w.activeChip?.def.id).toBe('cannon');
  });

  it('does not break or interrupt when god mode reduces applied damage to zero', () => {
    const w = world(true);
    give(w, 'cannon', 'sword');
    step(w, true);

    w.resolveHit({ target: w.player, damage: 1 });

    expect(w.combo?.status).toBe('active');
    expect(w.activeChip?.def.id).toBe('cannon');
  });

  it('does not break at one HP when no-KO prevents actual HP loss', () => {
    const w = new World({
      seed: 17,
      battleIndex: 1,
      playerHp: 1,
      skipIntro: true,
      cheats: { god: false, aiEnabled: false, noKo: true },
    });
    give(w, 'cannon', 'sword');
    step(w, true);

    w.resolveHit({ target: w.player, damage: 1 });

    expect(w.player.hp).toBe(1);
    expect(w.combo?.status).toBe('active');
    expect(w.activeChip?.def.id).toBe('cannon');
  });

  it('does not break when invulnerability prevents the hit', () => {
    const w = world();
    give(w, 'cannon', 'sword');
    step(w, true);
    w.player.iframeTicks = 2;
    const attack = new Shockwave(901, w.player.x, w.player.y, w.tick, {
      dir: 1, damage: 1, stepTicks: 99,
    });

    expect(w.hitPlayerAt(attack, w.player.x, w.player.y, 1)).toBe(false);
    expect(w.combo?.status).toBe('active');
  });
});

describe('Selection slow-mo (GDD §6.7)', () => {
  const select = (w: World, slot: number) => w.step(DT, { commands: [{ type: 'selectChip', slot }], held: null });
  const readySlots = (w: World) => w.chips.hand.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);

  it('slows the world while chips are queued and restores it when the queue is emptied', () => {
    const w = world();
    const [a] = readySlots(w);
    select(w, a!);
    run(w, T(tuning.combo.SELECT_SLOW_MO_ENTER) + 1);
    expect(w.worldTimeScale).toBeCloseTo(tuning.combo.SELECT_TIME_SCALE);

    select(w, a!);
    run(w, T(tuning.combo.SLOW_MO_EXIT) + 1);
    expect(w.worldTimeScale).toBe(1);
  });

  it('hands over to the combo scale on the first attack of a series', () => {
    const w = world();
    const [a, b] = readySlots(w);
    select(w, a!);
    select(w, b!);
    run(w, T(tuning.combo.SELECT_SLOW_MO_ENTER) + 1);
    step(w, true);
    expect(w.combo).not.toBeNull();
    run(w, T(tuning.combo.SLOW_MO_ENTER) + 1);
    expect(w.worldTimeScale).toBeCloseTo(tuning.combo.WORLD_TIME_SCALE);
  });

  it('returns to normal speed when the budget runs out, keeping the selection', () => {
    const w = world();
    const [a, b] = readySlots(w);
    select(w, a!);
    select(w, b!);
    // Both selecting steps already drained the budget.
    run(w, T(tuning.combo.SELECT_SLOW_MO_TIME) - 3);
    expect(w.worldTimeScale).toBeCloseTo(tuning.combo.SELECT_TIME_SCALE);
    expect(w.selectTimeLeft).toBeGreaterThan(0);

    run(w, 1);
    expect(w.selectTimeLeft).toBe(0);
    run(w, T(tuning.combo.SLOW_MO_EXIT) + 1);
    expect(w.worldTimeScale).toBe(1);
    expect(w.chips.attack).toEqual([a, b]);
  });

  it('refills the budget gradually, so reselecting does not restore it', () => {
    const w = world();
    const [a] = readySlots(w);
    select(w, a!);
    run(w, T(tuning.combo.SELECT_SLOW_MO_TIME));
    expect(w.selectTimeLeft).toBe(0);

    select(w, a!);
    const half = T(tuning.combo.SELECT_SLOW_MO_RECHARGE) / 2;
    run(w, half - 1);
    expect(w.selectTimeLeft).toBeCloseTo(0.5, 1);
    select(w, a!);
    run(w, T(tuning.combo.SELECT_SLOW_MO_ENTER) + 1);
    expect(w.worldTimeScale).toBeCloseTo(tuning.combo.SELECT_TIME_SCALE);
    run(w, T(tuning.combo.SELECT_SLOW_MO_TIME) / 2);
    expect(w.selectTimeLeft).toBe(0);
    run(w, T(tuning.combo.SLOW_MO_EXIT) + 1);
    expect(w.worldTimeScale).toBe(1);
  });

  it('gives every new hand a full budget and hides the timer while it is full', () => {
    const w = world();
    const [a] = readySlots(w);
    expect(w.selectTimeLeft).toBeNull();
    select(w, a!);
    run(w, T(tuning.combo.SELECT_SLOW_MO_TIME) / 2);
    step(w, true);
    expect(w.selectTimeLeft).toBeNull();
    run(w, T(tuning.chips.HAND_REFILL_COOLDOWN) + T(1));
    expect(w.chips.phase).toBe('selecting');
    expect(w.selectBudget).toBe(T(tuning.combo.SELECT_SLOW_MO_TIME));
    expect(w.selectTimeLeft).toBeNull();
  });

  it('returns to normal speed after a single chip fires', () => {
    const w = world();
    const [a] = readySlots(w);
    select(w, a!);
    run(w, T(tuning.combo.SELECT_SLOW_MO_ENTER) + 1);
    step(w, true);
    expect(w.combo).toBeNull();
    run(w, T(tuning.combo.SLOW_MO_EXIT) + 1);
    expect(w.worldTimeScale).toBe(1);
  });
});
