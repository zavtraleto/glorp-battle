import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import { CHIPS, type ChipId } from '../src/data/chips';
import { Rng } from '../src/core/rng';
import { ChipSystem } from '../src/sim/chips/chipSystem';
import { chipTiming } from '../src/sim/chips/executor';
import type { SimEvent } from '../src/sim/events';
import { World } from '../src/sim/world';

// Hand cooldown economy (GDD §5.1): kills, Counters and completed combos
// shorten the running cooldown, hits that cost HP lengthen it.

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);
let uid = 70_000;

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

function world(): World {
  const w = new World({ seed: 17, battleIndex: 1, skipIntro: true, cheats: { god: false, aiEnabled: false } });
  for (const enemy of w.enemies) enemy.hp = 10_000;
  return w;
}

function give(w: World, ...ids: ChipId[]): void {
  for (const defId of ids) w.giveChip({ uid: uid++, defId, state: 'queued', deal: 0 });
}

function step(w: World, use = false): SimEvent[] {
  w.step(DT, { commands: use ? [{ type: 'useChip' }] : [], held: null });
  return w.drainEvents();
}

function changes(events: SimEvent[]) {
  return events.filter((e) => e.type === 'handCooldownChanged');
}

const base = () => T(tuning.chips.HAND_REFILL_COOLDOWN);

describe('hand cooldown economy', () => {
  it('shortens the running cooldown per kill', () => {
    const w = world();
    give(w, 'cannon');
    step(w, true);
    expect(w.chips.cooldownSpan).toBe(base());
    const enemy = w.enemies[0]!;
    enemy.hp = 1;
    w.damageEnemy(enemy, 1);
    expect(w.chips.cooldownSpan).toBe(base() - T(tuning.chips.COOLDOWN_KILL_BONUS));
    expect(changes(w.drainEvents())).toEqual([
      { type: 'handCooldownChanged', reason: 'kill', seconds: -tuning.chips.COOLDOWN_KILL_BONUS },
    ]);
  });

  it('shortens the running cooldown per Counter hit', () => {
    const w = world();
    give(w, 'cannon');
    step(w, true);
    const enemy = w.enemies[0]!;
    enemy.setTimedState('COUNTER', w.tick, T(0.2));
    w.damageEnemy(enemy, 1, true);
    expect(enemy.state).toBe('STAGGER');
    expect(w.chips.cooldownSpan).toBe(base() - T(tuning.chips.COOLDOWN_COUNTER_BONUS));
    expect(changes(w.drainEvents())[0]).toMatchObject({ reason: 'counter' });
  });

  it('lengthens the running cooldown per hit that costs HP', () => {
    const w = world();
    give(w, 'cannon');
    step(w, true);
    w.resolveHit({ target: w.player, damage: 1 });
    expect(w.chips.cooldownSpan).toBe(base() + T(tuning.chips.COOLDOWN_HIT_PENALTY));
    expect(changes(w.drainEvents())).toEqual([
      { type: 'handCooldownChanged', reason: 'hit', seconds: tuning.chips.COOLDOWN_HIT_PENALTY },
    ]);
  });

  it('ignores a hit that Guard stops', () => {
    const w = world();
    give(w, 'cannon');
    step(w, true);
    w.player.guard = true;
    w.resolveHit({ target: w.player, damage: 1 });
    expect(w.chips.cooldownSpan).toBe(base());
  });

  it('changes nothing while no cooldown runs: hand ready or combo in progress', () => {
    const w = world();
    const enemy = w.enemies[0]!;
    enemy.hp = 1;
    w.damageEnemy(enemy, 1);
    w.resolveHit({ target: w.player, damage: 1 });
    expect(w.chips.cooldownSpan).toBeNull();
    expect(changes(w.drainEvents())).toEqual([]);
  });

  it('does not add the hit penalty to the cooldown a Combo Break starts', () => {
    const w = world();
    give(w, 'cannon', 'sword');
    step(w, true);
    expect(w.combo).not.toBeNull();
    w.resolveHit({ target: w.player, damage: 1 });
    expect(w.combo).toBeNull();
    expect(w.chips.cooldownSpan).toBe(base());
  });

  it('gives a completed combo a bonus per chip beyond the first', () => {
    const w = world();
    give(w, 'cannon', 'cannon', 'sword');
    step(w, true);
    const events: SimEvent[] = [];
    // Both Cannons run out, each time the next chip fires.
    for (let shot = 0; shot < 2; shot++) {
      for (let i = 0; i < chipTiming(CHIPS.cannon).totalTicks; i++) events.push(...step(w));
      events.push(...step(w, true));
      expect(w.activeChip).not.toBeNull();
    }
    for (let i = 0; i < chipTiming(CHIPS.sword).totalTicks; i++) events.push(...step(w));
    expect(w.combo).toBeNull();
    const bonus = tuning.chips.COOLDOWN_COMBO_BONUS * 2;
    expect(w.chips.cooldownSpan).toBe(base() - T(bonus));
    expect(changes(events)).toEqual([{ type: 'handCooldownChanged', reason: 'combo', seconds: -bonus }]);
  });

  it('keeps the full cooldown within HAND_COOLDOWN_MIN..MAX', () => {
    const w = world();
    give(w, 'cannon');
    step(w, true);
    for (let i = 0; i < 10; i++) {
      w.player.hp = w.player.maxHp;
      w.resolveHit({ target: w.player, damage: 1 });
    }
    expect(w.chips.cooldownSpan).toBe(T(tuning.chips.HAND_COOLDOWN_MAX));
    w.drainEvents();
    const s = new ChipSystem('starter', new Rng(1));
    s.startCooldown(0);
    const applied = s.adjustCooldown(0, -10);
    expect(s.cooldownSpan).toBe(T(tuning.chips.HAND_COOLDOWN_MIN));
    expect(applied).toBeCloseTo(tuning.chips.HAND_COOLDOWN_MIN - tuning.chips.HAND_REFILL_COOLDOWN, 5);
    expect(s.adjustCooldown(0, -1)).toBe(0);
  });

  it('refills the hand when the shortened cooldown ends', () => {
    const w = world();
    give(w, 'cannon');
    step(w, true);
    const enemy = w.enemies[0]!;
    enemy.setTimedState('COUNTER', w.tick, T(0.2));
    w.damageEnemy(enemy, 1, true);
    const span = w.chips.cooldownSpan!;
    for (let i = 0; i < span - 2; i++) step(w);
    expect(w.chips.phase).toBe('waiting');
    step(w);
    step(w);
    expect(w.chips.phase).toBe('selecting');
  });
});
