import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, tuning } from '../src/config/tuning';
import type { Command } from '../src/core/input/commands';
import { CHIPS, type ChipId } from '../src/data/chips';
import { chipTiming, useTicks } from '../src/sim/chips/executor';
import { shapeCells } from '../src/sim/chips/patterns';
import { Mettik } from '../src/sim/enemies/mettik';
import { World } from '../src/sim/world';

const DT = 1 / 60;
let uid = 10_000;
let enemyId = 20_000;

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

function makeWorld(): World {
  const w = new World({ seed: 7, battleIndex: 1, skipIntro: true, cheats: { god: true, aiEnabled: false } });
  for (const e of w.enemies) w.occupancy.remove(e.id, e.x, e.y);
  w.enemies = [];
  return w;
}

function addEnemy(w: World, x: number, y: number, hp = 30): Mettik {
  const e = new Mettik(enemyId++, x, y, w.tick);
  e.hp = hp;
  w.occupancy.place(e.id, x, y);
  w.enemies.push(e);
  return e;
}

function give(w: World, ...ids: ChipId[]): void {
  for (const defId of ids) w.giveChip({ uid: uid++, defId, code: '*', state: 'queued', deal: 0 });
}

function step(w: World, commands: Command[] = []): void {
  w.step(DT, { commands, held: null });
}

function run(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(w);
}

function use(w: World): void { step(w, [{ type: 'useChip' }]); }

describe('ten-chip geometry', () => {
  it('keeps Sword adjacent and WideSword three cells wide', () => {
    expect(shapeCells(CHIPS.sword.shape, 1, 3, () => -1)).toEqual([{ x: 1, y: 2 }]);
    expect(shapeCells(CHIPS.widesword.shape, 1, 3, () => -1)).toEqual([
      { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 },
    ]);
  });
});

describe('ten-chip execution', () => {
  it('resolves Cannon after startup and releases its lock after recovery', () => {
    const w = makeWorld();
    const target = addEnemy(w, 1, 2);
    give(w, 'cannon');
    use(w);
    run(w, chipTiming(CHIPS.cannon).startupTicks - 1);
    expect(target.hp).toBe(30);
    run(w, 1);
    expect(target.hp).toBe(30 - CHIPS.cannon.power!);
    run(w, chipTiming(CHIPS.cannon).recoveryTicks);
    expect(w.activeChip).toBeNull();
  });

  it('uses two committed neutral-code chips in order', () => {
    const w = makeWorld();
    addEnemy(w, 1, 1, 100);
    give(w, 'cannon', 'sword');
    use(w);
    expect(w.activeChip?.def.id).toBe('cannon');
    run(w, useTicks(CHIPS.cannon));
    use(w);
    expect(w.activeChip?.def.id).toBe('sword');
  });

  it('WideSword damages multiple enemies once', () => {
    const w = makeWorld();
    w.occupancy.move(w.player.id, w.player.x, w.player.y, 1, 3);
    w.player.y = w.player.prevY = 3;
    const enemies = [addEnemy(w, 0, 2), addEnemy(w, 1, 2), addEnemy(w, 2, 2)];
    give(w, 'widesword');
    use(w);
    run(w, chipTiming(CHIPS.widesword).startupTicks);
    expect(enemies.map((e) => e.hp)).toEqual(enemies.map(() => 30 - CHIPS.widesword.power!));
  });

  it('Guard sets one charge', () => {
    const w = makeWorld();
    addEnemy(w, 0, 0);
    give(w, 'guard');
    use(w);
    run(w, chipTiming(CHIPS.guard).startupTicks);
    expect(w.player.guard).toBe(true);
  });
});
