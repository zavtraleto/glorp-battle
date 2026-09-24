import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { Enemy } from '../src/sim/enemies/enemyBase';
import { World } from '../src/sim/world';
import { LaneShot } from '../src/sim/attacks/laneShot';

const DT = 1 / 60;
const T = (seconds: number) => secondsToTicks(seconds);

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

function world(aiEnabled = false): World {
  return new World({ seed: 7, battleIndex: 1, skipIntro: true, cheats: { god: false, aiEnabled } });
}

function enemyAt(w: World, x: number, y: number): Enemy {
  const enemy = w.enemies[0]!;
  w.occupancy.move(enemy.id, enemy.x, enemy.y, x, y);
  enemy.x = enemy.prevX = x;
  enemy.y = enemy.prevY = y;
  enemy.hp = 20;
  return enemy;
}

function run(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) w.step(DT);
}

describe('forced movement physics', () => {
  it('moves through ownership and triggers ARM on the landing cell', () => {
    const w = world();
    const enemy = enemyAt(w, 1, 2);
    w.field.arm(1, 1, { kind: 'mine', side: 'player', damage: 6 });

    expect(w.pushEnemy(enemy, { x: 1, y: 3 })).toBe('moved');

    expect([enemy.x, enemy.y, enemy.hp]).toEqual([1, 1, 14]);
    expect(w.field.hazard(1, 1)).toBeNull();
  });

  it('applies collision stagger when PUSH lands on BREAK and resumes the paused phase', () => {
    const w = world();
    const enemy = enemyAt(w, 1, 2);
    enemy.setTimedState('LOCK', w.tick, T(1));
    const before = enemy.phaseRemaining(w.tick);
    w.field.breakPanel(1, 1, w.tick, T(2));

    expect(w.pushEnemy(enemy, { x: 1, y: 3 })).toBe('blocked');
    expect(enemy.state).toBe('STAGGER');
    run(w, T(0.25));
    expect(enemy.state).toBe('LOCK');
    expect(enemy.phaseRemaining(w.tick)).toBe(before);
  });

  it('queues PUSH during a current move and applies it immediately after landing', () => {
    const w = world();
    const enemy = enemyAt(w, 1, 2);
    enemy.lastMoveTick = w.tick;

    expect(w.pushEnemy(enemy, { x: 1, y: 3 })).toBe('queued');
    expect([enemy.x, enemy.y]).toEqual([1, 2]);
    run(w, T(enemy.moveDurationSeconds()));
    expect([enemy.x, enemy.y]).toEqual([1, 1]);
  });
});

describe('ARM entry physics', () => {
  it('triggers when the player voluntarily enters the armed cell', () => {
    const w = world();
    const hp = w.player.hp;
    w.field.arm(1, 3, { kind: 'mine', side: 'enemy', damage: 6 });

    w.step(DT, { commands: [{ type: 'move', dir: 'up' }], held: null });

    expect([w.player.x, w.player.y]).toEqual([1, 3]);
    expect(w.player.hp).toBe(hp - 6);
    expect(w.field.hazard(1, 3)).toBeNull();
  });

  it('triggers when an enemy voluntarily enters the armed cell', () => {
    const w = world(true);
    const enemy = enemyAt(w, 0, 1);
    w.field.arm(1, 1, { kind: 'mine', side: 'player', damage: 6 });

    run(w, T(tuning.mettik.MOVE_TIME));

    expect([enemy.x, enemy.y]).toEqual([1, 1]);
    expect(enemy.hp).toBe(14);
    expect(w.field.hazard(1, 1)).toBeNull();
  });
});

describe('OCCUPY physics', () => {
  it('keeps a player Block duration unscaled while the world is slowed', () => {
    const w = world();
    w.setWorldTimeScale(0.5, 0);
    expect(w.placeBlock(0, 1)).not.toBeNull();

    run(w, T(tuning.field.BLOCK_DURATION));

    expect(w.objectAt(0, 1)).toBeNull();
  });

  it('places Block on either territory and removes its collision at expiry', () => {
    const w = world();
    const block = w.placeBlock(0, 1);
    expect(block).not.toBeNull();
    expect(block?.hp).toBe(tuning.field.BLOCK_HP);
    expect(w.occupancy.isFree(0, 1)).toBe(false);

    run(w, T(tuning.field.BLOCK_DURATION));

    expect(w.objectAt(0, 1)).toBeNull();
    expect(w.occupancy.isFree(0, 1)).toBe(true);
  });

  it('BREAK destroys Block before replacing the cell topology', () => {
    const w = world();
    w.placeBlock(0, 1);

    expect(w.breakCell(0, 1, T(2))).toBe(true);

    expect(w.objectAt(0, 1)).toBeNull();
    expect(w.field.panel(0, 1)).toBe('BROKEN');
  });

  it('same-tick projectiles both collide with the Block present at tick start', () => {
    const w = world();
    const block = w.placeBlock(1, 3)!;
    block.hp = 1;
    const first = new LaneShot(w.nextAttackId(), 'zapring', 1, 3, w.tick, { damage: 1, stepTicks: T(1) });
    const second = new LaneShot(w.nextAttackId(), 'zapring', 1, 3, w.tick, { damage: 1, stepTicks: T(1) });
    w.spawnAttack(first);
    w.spawnAttack(second);

    w.step(DT);

    expect(first.done).toBe(true);
    expect(second.done).toBe(true);
    expect(w.player.hitsTaken).toBe(0);
  });
});

describe('ordered hit resolution', () => {
  it('checks Counter before damage and records the full resolution order', () => {
    const w = world();
    const enemy = enemyAt(w, 1, 2);
    enemy.setTimedState('COUNTER', w.tick, T(1));

    const outcome = w.resolveHit({ target: enemy, damage: 2, canCounter: true });

    expect(outcome.order).toEqual(['counter', 'guard', 'damage', 'death', 'secondary', 'world']);
    expect(outcome.countered).toBe(true);
    expect(enemy.hp).toBe(18);
    expect(enemy.state).toBe('STAGGER');
  });

  it('Guard consumes only a positive-damage hit and prevents its damage', () => {
    const w = world();
    w.player.guard = true;
    const hp = w.player.hp;

    const utility = w.resolveHit({ target: w.player, damage: 0 });
    expect(utility.guarded).toBe(false);
    expect(w.player.guard).toBe(true);

    const damage = w.resolveHit({ target: w.player, damage: 2 });
    expect(damage.guarded).toBe(true);
    expect(w.player.guard).toBe(false);
    expect(w.player.hp).toBe(hp);
  });
});
