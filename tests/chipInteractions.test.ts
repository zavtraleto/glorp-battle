import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { Command } from '../src/core/input/commands';
import { CHIPS, type ChipId } from '../src/data/chips';
import { useTicks } from '../src/sim/chips/executor';
import type { Enemy } from '../src/sim/enemies/enemyBase';
import { Mettik } from '../src/sim/enemies/mettik';
import { World } from '../src/sim/world';

const DT = 1 / 60;
let uid = 80_000;
let enemyId = 90_000;

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

function world(): World {
  const w = new World({ seed: 7, battleIndex: 1, skipIntro: true, cheats: { god: false, aiEnabled: false } });
  for (const enemy of w.enemies) w.occupancy.remove(enemy.id, enemy.x, enemy.y);
  w.enemies = [];
  return w;
}

function enemy(w: World, x: number, y: number, hp = 30): Enemy {
  const e = new Mettik(enemyId++, x, y, w.tick);
  e.hp = hp;
  w.occupancy.place(e.id, x, y);
  w.enemies.push(e);
  return e;
}

function give(w: World, id: ChipId): void {
  w.giveChip({ uid: uid++, defId: id, state: 'queued', deal: 0 });
}

function step(w: World, commands: Command[] = []): void {
  w.step(DT, { commands, held: null });
}

function run(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(w);
}

function fire(w: World, id: ChipId): void {
  for (let i = 0; i < 120 && w.activeChip; i++) step(w);
  step(w);
  give(w, id);
  step(w, [{ type: 'useChip' }]);
  expect(w.activeChip?.def.id).toBe(id);
  for (let i = 0; i < useTicks(CHIPS[id]) + 2 && w.activeChip; i++) step(w);
}

function fireQueued(w: World, id: ChipId): void {
  for (let i = 0; i < 120 && w.activeChip; i++) step(w);
  step(w);
  step(w, [{ type: 'useChip' }]);
  expect(w.activeChip?.def.id).toBe(id);
  for (let i = 0; i < useTicks(CHIPS[id]) + 2 && w.activeChip; i++) step(w);
}

describe('ten-chip systemic interactions', () => {
  it('Mine -> AirShot triggers ARM through forced entry', () => {
    const w = world();
    // The player steps up to row 3, so the mine lands one row behind the target.
    const target = enemy(w, 1, 3 - tuning.mine.TARGET_DISTANCE + 1);
    give(w, 'mine');
    give(w, 'airshot');
    step(w, [{ type: 'move', dir: 'up' }]);
    step(w, [{ type: 'useChip' }]);
    for (let i = 0; i < useTicks(CHIPS.mine) + 2 && w.activeChip; i++) step(w);

    fireQueued(w, 'airshot');

    expect([target.x, target.y, target.hp]).toEqual([
      1, 3 - tuning.mine.TARGET_DISTANCE, 30 - CHIPS.airshot.power! - CHIPS.mine.power!,
    ]);
  });

  it('Block makes a failed AirShot displacement stagger the enemy', () => {
    const w = world();
    const target = enemy(w, 1, 2);
    w.placeBlock(1, 1);

    fire(w, 'airshot');

    expect([target.x, target.y, target.state]).toEqual([1, 2, 'STAGGER']);
  });

  it('Area Grab leaves an enemy its panel and chips it for areagrab.OCCUPANT_DMG', () => {
    const w = world();
    const target = enemy(w, 1, 2);
    fire(w, 'areagrab');

    expect([w.field.owner(0, 2), w.field.owner(1, 2), w.field.owner(2, 2)]).toEqual(['player', 'enemy', 'player']);
    expect(target.hp).toBe(30 - tuning.areagrab.OCCUPANT_DMG);
    expect(target.state).not.toBe('STAGGER');
  });

  it('Area Grab creates the position needed for Sword', () => {
    const w = world();
    const target = enemy(w, 1, 1);
    give(w, 'areagrab');
    give(w, 'sword');
    fireQueued(w, 'areagrab');
    step(w, [{ type: 'move', dir: 'up' }]);
    run(w, secondsToTicks(tuning.player.CELL_MOVE_TIME));
    step(w, [{ type: 'move', dir: 'up' }]);
    expect(w.player.y).toBe(2);

    fireQueued(w, 'sword');

    expect(target.hp).toBe(30 - CHIPS.sword.power!);
  });

  it('Cannon travels through BREAK', () => {
    const w = world();
    const target = enemy(w, 1, 1);
    w.breakCell(1, 2, secondsToTicks(2));

    fire(w, 'cannon');

    expect(target.hp).toBe(30 - CHIPS.cannon.power!);
  });

  it('Spreader splashes only the side cells of a living target', () => {
    const w = world();
    const main = enemy(w, 1, 1);
    const left = enemy(w, 0, 1);
    const right = enemy(w, 2, 1);

    fire(w, 'spreader');

    expect([main.hp, left.hp, right.hp]).toEqual([
      30 - CHIPS.spreader.power!,
      30 - CHIPS.spreader.splashPower!,
      30 - CHIPS.spreader.splashPower!,
    ]);
  });

  it('Guard blocks exactly the next damaging hit', () => {
    const w = world();
    enemy(w, 0, 0);
    fire(w, 'guard');
    const hp = w.player.hp;
    const hit = { id: -1, kind: 'test', hitIds: new Set<number>(), done: true, update: () => undefined };

    expect(w.hitPlayerAt(hit, w.player.x, w.player.y, 2)).toBe(true);
    expect(w.player.hp).toBe(hp);
    hit.hitIds.clear();
    expect(w.hitPlayerAt(hit, w.player.x, w.player.y, 2)).toBe(true);
    expect(w.player.hp).toBe(hp - 2);
  });
});
