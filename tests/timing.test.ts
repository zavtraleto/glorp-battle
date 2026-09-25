import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import { FixedStepClock } from '../src/core/loop';
import { CHIPS } from '../src/data/chips';
import { enemyTimingLines } from '../src/debug/overlay';
import { Shockwave } from '../src/sim/attacks/shockwave';
import { chipTiming } from '../src/sim/chips/executor';
import type { EnemyState } from '../src/sim/enemies/enemyBase';
import type { SimEvent } from '../src/sim/events';
import { World } from '../src/sim/world';

const DT = 1 / 60;
const T = (seconds: number) => secondsToTicks(seconds);

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

function timingWorld(): World {
  return new World({
    seed: 23,
    battleIndex: 1,
    skipIntro: true,
    cheats: { god: true, aiEnabled: true },
    encounter: {
      id: 'timing-world',
      tier: 'normal',
      minDepth: 1,
      maxDepth: 1,
      waves: [{ enemies: [{ kind: 'mettik', x: 1, y: 1 }] }],
    },
  });
}

describe('time-based combat timing', () => {
  it('keeps player time unscaled while the world advances at its own scale', () => {
    const w = timingWorld();
    w.cheats.aiEnabled = false;
    w.setWorldTimeScale(0.5, 0);

    for (let i = 0; i < 60; i++) w.step(DT);

    expect(w.playerTick).toBe(60);
    expect(w.tick).toBe(30);
    expect(w.time).toBeCloseTo(1, 5);
  });

  it('moves a standard projectile one cell per configured travel time', () => {
    const shot = new Shockwave(1, 1, 1, 0, {
      dir: 1,
      damage: 10,
      stepTicks: T(tuning.mettik.WAVE_CELL_TIME),
    });
    const w = timingWorld();
    w.attacks = [shot];
    for (let i = 0; i < T(tuning.mettik.WAVE_CELL_TIME) - 1; i++) w.step(DT);
    expect(shot.y).toBe(1);
    w.step(DT);
    expect(shot.y).toBe(2);
  });

  it.each([30, 60, 120])('produces the same combat state at %i render FPS', (fps) => {
    const run = (renderFps: number) => {
      const clock = new FixedStepClock({ hz: 60, maxFrameTime: 0.25 });
      const w = timingWorld();
      w.enemies[0]!.forceAttack(w.tick);
      let strikes = 0;
      for (let frame = 0; frame < Math.round(renderFps * 1.5); frame++) {
        const ticks = clock.advance(1 / renderFps);
        for (let n = 0; n < ticks; n++) {
          w.step(clock.dt);
          strikes += w.drainEvents().filter((event) => event.type === 'attackSpawned').length;
        }
      }
      return {
        tick: w.tick,
        enemy: w.enemies.map((enemy) => [enemy.kind, enemy.state, enemy.x, enemy.y]),
        attacks: w.attacks.map((attack) => attack.kind),
        strikes,
      };
    };

    expect(run(fps)).toEqual(run(60));
  });

  it('formats enemy phase and remaining milliseconds', () => {
    const w = timingWorld();
    const enemy = w.enemies[0]!;
    enemy.setTimedState('COUNTER', 10, 6);
    expect(enemyTimingLines([enemy], 10, 60)).toBe(`mettik#${enemy.id} COUNTER 100ms`);
  });

  it('runs the playtest timing flow', () => {
    const w = timingWorld();
    const enemy = w.enemies[0]!;
    enemy.hp = 200;
    w.chips.attack = [];
    for (const uid of [9101, 9102]) {
      w.giveChip({ uid, defId: 'cannon', state: 'hand', deal: 0 });
    }
    expect(w.chips.attackChips()).toHaveLength(2);

    const events: SimEvent[] = [];
    const timedStates = new Set<EnemyState>();
    const step = (commands: Parameters<World['step']>[1] = { commands: [], held: null }) => {
      w.step(DT, commands);
      events.push(...w.drainEvents());
      if (['INTENTION', 'LOCK', 'COUNTER', 'STRIKE', 'RECOVERY'].includes(enemy.state)) {
        timedStates.add(enemy.state);
        expect(Number.isFinite(enemy.stateEndTick)).toBe(true);
      }
    };
    const run = (ticks: number) => {
      for (let i = 0; i < ticks; i++) step();
    };

    step({ commands: [{ type: 'move', dir: 'up' }], held: null });
    enemy.forceAttack(w.tick);
    run(T(tuning.mettik.INTENTION_TIME));
    expect(enemy.state).toBe('LOCK');

    step({ commands: [{ type: 'useChip' }], held: null });
    expect(w.activeChip?.def.id).toBe('cannon');
    run(chipTiming(CHIPS.cannon).startupTicks);
    expect(enemy.state).toBe('LOCK');
    expect(enemy.hp).toBe(196);
    for (let i = 0; i < 60 && enemy.state === 'LOCK'; i++) step();
    expect(enemy.state).toBe('COUNTER');
    // The first Cannon may still be recovering: the second press waits for a free player.
    for (let i = 0; i < 60 && (w.activeChip || w.player.actionTicks > 0); i++) step();
    expect(enemy.state).toBe('COUNTER');
    step({ commands: [{ type: 'useChip' }], held: null });
    expect(enemy.state).toBe('COUNTER');
    run(chipTiming(CHIPS.cannon).startupTicks);
    expect(enemy.state).toBe('STAGGER');

    // The stagger runs on the world clock, which the combo slows down.
    for (let i = 0; i < 120 && enemy.state === 'STAGGER'; i++) step();
    enemy.forceAttack(w.tick);
    run(T(tuning.mettik.INTENTION_TIME + tuning.mettik.LOCK_TIME + tuning.mettik.COUNTER_TIME));
    run(T(tuning.mettik.STRIKE_TIME + tuning.mettik.RECOVERY_TIME));

    expect(w.player.y).toBe(3);
    expect(events.filter((event) => event.type === 'enemyCountered')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'attackSpawned')).toHaveLength(1);
    expect(timedStates).toEqual(new Set<EnemyState>(['INTENTION', 'LOCK', 'COUNTER', 'STRIKE', 'RECOVERY']));
  });
});
