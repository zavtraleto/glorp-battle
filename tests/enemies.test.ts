import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { Command, Dir } from '../src/core/input/commands';
import { BATTLES } from '../src/data/battles';
import { ENEMY_LEVELS } from '../src/data/enemies';
import { CHIPS } from '../src/data/chips';
import { Shockwave } from '../src/sim/attacks/shockwave';
import { Mettik } from '../src/sim/enemies/mettik';
import { Canodron } from '../src/sim/enemies/canodron';
import { useTicks } from '../src/sim/chips/executor';
import type { SimEvent } from '../src/sim/events';
import { World } from '../src/sim/world';

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);
const events: SimEvent[] = [];

beforeEach(() => {
  mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING)));
  events.length = 0;
});

function world(battle: number, seed = 1): World {
  return new World({ seed, battleIndex: battle, skipIntro: true, cheats: { god: false, aiEnabled: true } });
}

function step(w: World, commands: Command[] = [], held: Dir | null = null): void {
  w.step(DT, { commands, held });
  events.push(...w.drainEvents());
}
const run = (w: World, n: number) => {
  for (let i = 0; i < n; i++) step(w);
};
const move = (w: World, dir: Dir) => step(w, [{ type: 'move', dir }]);

/** Moves the player to lane x (keeps the row). */
function toLane(w: World, x: number): void {
  while (w.player.x !== x) {
    move(w, x < w.player.x ? 'left' : 'right');
    run(w, T(tuning.player.CELL_MOVE_TIME));
  }
}

describe('battles', () => {
  it('spawn the enemies from data, each on its own panel', () => {
    BATTLES.forEach((def, i) => {
      const w = world(i + 1);
      expect(w.enemies.map((e) => e.kind)).toEqual(def.waves[0]!.enemies.map((s) => s.kind));
      const cells = new Set(w.enemies.map((e) => `${e.x},${e.y}`));
      expect(cells.size).toBe(w.enemies.length);
      for (const e of w.enemies) expect(w.occupancy.get(e.x, e.y)).toBe(e.id);
    });
  });
});

describe('Canodron', () => {
  const cano = (w: World) => w.enemies[0] as Canodron;

  it('does nothing while the player is out of its lane', () => {
    const w = world(2);
    toLane(w, 0);
    run(w, T(5));
    expect(cano(w).state).toBe('IDLE');
    expect(w.player.hp).toBe(w.player.maxHp);
  });

  it('sends a cursor, locks on the player and fires after the delay', () => {
    const w = world(2); // Canodron at (1,1), player at (1,4)
    step(w);
    const c = cano(w);
    expect(c.state).toBe('INTENTION');
    expect(c.cursorCell()).toMatchObject({ x: 1, y: 2, locked: false });
    // Cursor needs two steps (2→3→4) to reach the player.
    run(w, 2 * T(tuning.canodron.CURSOR_STEP));
    expect(c.cursorCell()).toMatchObject({ x: 1, y: 4, locked: true });
    expect(w.dangerCells().length).toBe(4);
    run(w, T(tuning.canodron.LOCK_TIME + tuning.canodron.COUNTER_TIME) - 1);
    expect(w.player.hp).toBe(w.player.maxHp);
    run(w, 1);
    expect(w.player.hp).toBe(w.player.maxHp - tuning.canodron.DMG);
    expect(events.some((e) => e.type === 'enemyShot' && e.toY === 4)).toBe(true);
    expect(c.state).toBe('STRIKE');
  });

  it('the locked shot misses if the player dodges during the fire delay', () => {
    const w = world(2);
    step(w);
    run(w, 2 * T(tuning.canodron.CURSOR_STEP));
    expect(cano(w).cursorCell()?.locked).toBe(true);
    move(w, 'left');
    run(w, T(tuning.canodron.LOCK_TIME + tuning.canodron.COUNTER_TIME));
    expect(w.player.hp).toBe(w.player.maxHp);
    expect(events.some((e) => e.type === 'enemyShot' && e.toY === 6)).toBe(true);
  });

  it('leaving the lane before the lock cancels the cursor without a cooldown', () => {
    const w = world(2);
    step(w);
    move(w, 'left');
    expect(cano(w).state).toBe('IDLE');
    expect(cano(w).cursorCell()).toBeNull();
    run(w, T(tuning.player.CELL_MOVE_TIME));
    move(w, 'right');
    expect(cano(w).state).toBe('INTENTION');
  });

  it('cools down after firing', () => {
    const w = world(2);
    run(w, 1 + 2 * T(tuning.canodron.CURSOR_STEP) + T(tuning.canodron.LOCK_TIME + tuning.canodron.COUNTER_TIME));
    expect(w.player.hp).toBe(w.player.maxHp - tuning.canodron.DMG);
    run(w, T(tuning.canodron.STRIKE_TIME + tuning.canodron.RECOVERY_TIME) - 2);
    expect(cano(w).state).toBe('RECOVERY');
    run(w, 2);
    expect(['IDLE', 'INTENTION']).toContain(cano(w).state);
  });

  it('holds the cursor on the player row until Intention completes, then locks', () => {
    const w = world(2);
    move(w, 'up'); // (1,3)
    run(w, T(tuning.canodron.CURSOR_STEP));
    expect(cano(w).cursorCell()).toMatchObject({ x: 1, y: 3, locked: false });
    run(w, T(tuning.canodron.INTENTION_TIME - tuning.canodron.CURSOR_STEP));
    expect(cano(w).cursorCell()).toMatchObject({ x: 1, y: 3, locked: true });
  });

  it('a cursor that passes the player resets at the last row', () => {
    const w = world(2);
    const p = w.player;
    const placePlayer = (y: number) => {
      w.occupancy.move(p.id, p.x, p.y, p.x, y);
      p.y = p.prevY = y;
    };
    placePlayer(3);
    step(w); // cursor starts at y=2
    placePlayer(5);
    run(w, 2 * T(tuning.canodron.CURSOR_STEP)); // cursor passes y=3 and reaches y=4
    placePlayer(3); // now behind the cursor
    let reset = false;
    for (let i = 0; i < 3 * T(tuning.canodron.CURSOR_STEP); i++) {
      step(w);
      if (cano(w).state === 'IDLE') reset = true;
    }
    expect(reset).toBe(true);
    expect(w.player.hp).toBe(w.player.maxHp);
  });
});

describe('battles 2–4 are winnable', () => {
  it.each([2, 3, 4])('battle %i with god mode and Cannon chips', (battle) => {
    const w = world(battle, 9);
    w.cheats.god = true;
    for (let i = 0; i < 200 && w.state === 'ACTION'; i++) {
      // Aim at the enemy with the lowest HP.
      const target = [...w.enemies].filter((e) => e.alive).sort((a, b) => a.hp - b.hp)[0];
      if (!target) break;
      if (target.x !== w.player.x) {
        move(w, target.x < w.player.x ? 'left' : 'right');
        run(w, T(tuning.player.CELL_MOVE_TIME));
        continue;
      }
      w.giveChip({ uid: 20_000 + i, defId: 'cannon', state: 'queued', deal: 0 });
      step(w, [{ type: 'useChip' }]);
      run(w, useTicks(CHIPS.cannon));
    }
    expect(w.state).toBe('BATTLE_WON');
  });
});

describe('levels and player paralysis', () => {
  /** Battle 1 with its Mettik replaced by one of the given level. */
  function withMettik(level: 1 | 2 | 3): { w: World; m: Mettik } {
    const w = world(1);
    const old = w.enemies[0]!;
    w.occupancy.remove(old.id, old.x, old.y);
    const m = new Mettik(500, 1, 1, w.tick, level);
    w.occupancy.place(m.id, 1, 1);
    w.enemies = [m];
    return { w, m };
  }

  it('scales HP, damage and timings by level', () => {
    const one = withMettik(1);
    const two = withMettik(2);
    expect(two.m.hp).toBe(Math.round(tuning.mettik.HP * ENEMY_LEVELS[2].hp));
    const firstWave = (w: World) => {
      for (let i = 0; i < T(5); i++) {
        step(w);
        const a = w.attacks.find((x) => x.kind === 'shockwave');
        if (a) return { at: i, damage: (a as Shockwave).damage };
      }
      return { at: -1, damage: 0 };
    };
    const a = firstWave(one.w);
    const b = firstWave(two.w);
    expect(b.damage).toBe(Math.round(tuning.mettik.DMG * ENEMY_LEVELS[2].damage));
    expect(a.damage).toBe(tuning.mettik.DMG);
    expect(b.at).toBeGreaterThan(0);
    expect(b.at).toBeLessThan(a.at);
  });

  it('paralysis stops the player without i-frames', () => {
    const { w } = withMettik(1);
    w.cheats.aiEnabled = false;
    w.paralyzePlayer(T(1));
    move(w, 'left');
    expect(w.player.x).toBe(1);
    expect(w.player.invulnerable).toBe(false);
    w.giveChip({ uid: 30_001, defId: 'cannon', state: 'queued', deal: 0 });
    step(w, [{ type: 'useChip' }]);
    expect(w.activeChip).toBeNull();
    run(w, T(1));
    move(w, 'left');
    expect(w.player.x).toBe(0);
  });
});
