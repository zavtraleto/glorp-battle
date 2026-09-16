import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { Command, Dir } from '../src/core/input/commands';
import type { ChipId } from '../src/data/chips';
import { Shockwave } from '../src/sim/attacks/shockwave';
import { useTicks } from '../src/sim/chips/executor';
import { hitscanCells, lobTarget, meleeCells } from '../src/sim/chips/patterns';
import { Mettik } from '../src/sim/enemies/mettik';
import type { SimEvent } from '../src/sim/events';
import { World } from '../src/sim/world';
import { CHIPS } from '../src/data/chips';

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);
let uid = 5000;
let enemyId = 900;
const events: SimEvent[] = [];

beforeEach(() => {
  mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING)));
  events.length = 0;
});

/** Battle with no enemies from data; tests place their own. */
function makeWorld(): World {
  const w = new World({ seed: 1, battleIndex: 1, skipIntro: true, cheats: { god: false, aiEnabled: false } });
  for (const e of w.enemies) w.occupancy.remove(e.id, e.x, e.y);
  w.enemies = [];
  // Discard the chip picked by skipIntro so each test controls the queue.
  w.chips.queue = [];
  // A durable enemy out of every tested pattern keeps the battle from ending.
  addEnemy(w, 2, 0, 9999);
  return w;
}

function addEnemy(w: World, x: number, y: number, hp = 200): Mettik {
  const m = new Mettik(enemyId++, x, y, w.tick);
  m.hp = hp;
  w.occupancy.place(m.id, x, y);
  w.enemies.push(m);
  return m;
}

function give(w: World, ...ids: ChipId[]): void {
  for (const defId of ids) w.giveChip({ uid: uid++, defId, code: '*', state: 'queued' });
}

function step(w: World, commands: Command[] = [], held: Dir | null = null): void {
  w.step(DT, { commands, held });
  events.push(...w.drainEvents());
}
const run = (w: World, n: number) => {
  for (let i = 0; i < n; i++) step(w);
};
const use = (w: World) => step(w, [{ type: 'useChip' }]);
const hitFrame = () => T(tuning.chips.CHIP_HIT_FRAME);

function movePlayer(w: World, x: number, y: number): void {
  const p = w.player;
  w.occupancy.move(p.id, p.x, p.y, x, y);
  p.x = p.prevX = x;
  p.y = p.prevY = y;
}

describe('pattern geometry', () => {
  it('melee cells', () => {
    expect(meleeCells('melee_1', 1, 3)).toEqual([{ x: 1, y: 2 }]);
    expect(meleeCells('melee_wide', 1, 3)).toEqual([
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ]);
    expect(meleeCells('melee_wide', 0, 4)).toEqual([
      { x: 0, y: 3 },
      { x: 1, y: 3 },
    ]);
    expect(meleeCells('melee_long', 2, 3)).toEqual([
      { x: 2, y: 2 },
      { x: 2, y: 1 },
    ]);
  });

  it('lob lands three rows ahead', () => {
    expect(lobTarget(1, 3)).toEqual({ x: 1, y: 0 });
    expect(lobTarget(1, 4)).toEqual({ x: 1, y: 1 });
    expect(lobTarget(1, 5)).toEqual({ x: 1, y: 2 });
  });

  it('hitscan with pierce adds the panel behind the target', () => {
    expect(hitscanCells('lane_hitscan', 1, 4, () => 1)).toEqual([{ x: 1, y: 1 }]);
    expect(hitscanCells('lane_hitscan_pierce1', 1, 4, () => 1)).toEqual([
      { x: 1, y: 1 },
      { x: 1, y: 0 },
    ]);
    expect(hitscanCells('lane_hitscan_pierce1', 1, 4, () => 0)).toEqual([{ x: 1, y: 0 }]);
    expect(hitscanCells('lane_hitscan', 1, 4, () => -1)).toEqual([]);
  });
});

describe('chip use', () => {
  it('Cannon hits the first enemy in the lane at the hit frame', () => {
    const w = makeWorld();
    const front = addEnemy(w, 1, 2);
    const back = addEnemy(w, 1, 0);
    give(w, 'cannon');
    use(w);
    expect(w.activeChip?.def.id).toBe('cannon');
    run(w, hitFrame() - 1);
    expect(front.hp).toBe(200);
    run(w, 1);
    expect(front.hp).toBe(200 - 40);
    expect(back.hp).toBe(200);
  });

  it('HiCannon deals 80', () => {
    const w = makeWorld();
    const e = addEnemy(w, 1, 1);
    give(w, 'hicannon');
    use(w);
    run(w, hitFrame());
    expect(e.hp).toBe(120);
  });

  it('Sword only reaches the adjacent panel', () => {
    const w = makeWorld();
    const e = addEnemy(w, 1, 2);
    give(w, 'sword', 'sword');
    use(w); // from (1,4): hits (1,3) → miss
    run(w, useTicks(CHIPS.sword));
    expect(e.hp).toBe(200);
    movePlayer(w, 1, 3);
    use(w);
    run(w, hitFrame());
    expect(e.hp).toBe(120);
  });

  it('WideSword hits the whole row in front, each enemy once', () => {
    const w = makeWorld();
    movePlayer(w, 1, 3);
    const a = addEnemy(w, 0, 2);
    const b = addEnemy(w, 1, 2);
    const c = addEnemy(w, 2, 2);
    const far = addEnemy(w, 1, 1);
    give(w, 'widesword');
    use(w);
    run(w, useTicks(CHIPS.widesword));
    expect([a.hp, b.hp, c.hp, far.hp]).toEqual([120, 120, 120, 200]);
  });

  it('LongSword reaches two panels', () => {
    const w = makeWorld();
    movePlayer(w, 0, 3);
    const a = addEnemy(w, 0, 2);
    const b = addEnemy(w, 0, 1);
    give(w, 'longsword');
    use(w);
    run(w, hitFrame());
    expect([a.hp, b.hp]).toEqual([120, 120]);
  });

  it('Shotgun hits the target and the panel behind it', () => {
    const w = makeWorld();
    const a = addEnemy(w, 1, 1);
    const b = addEnemy(w, 1, 0);
    give(w, 'shotgun');
    use(w);
    run(w, hitFrame());
    expect([a.hp, b.hp]).toEqual([170, 170]);
  });

  it('MiniBomb lands after its flight and damages the landing panel', () => {
    const w = makeWorld();
    const target = addEnemy(w, 1, 1); // player at (1,4) → lands on (1,1)
    const inFront = addEnemy(w, 1, 2);
    give(w, 'minibomb');
    use(w);
    run(w, hitFrame());
    expect(w.bombs).toHaveLength(1);
    run(w, T(tuning.chips.BOMB_FLIGHT_TIME) - 1);
    expect(target.hp).toBe(200);
    run(w, 1);
    expect(target.hp).toBe(150);
    expect(inFront.hp).toBe(200);
    expect(w.bombs).toHaveLength(0);
  });

  it('Recover50 heals instantly and caps at max HP', () => {
    const w = makeWorld();
    w.player.hp = 30;
    give(w, 'recover50', 'recover50');
    use(w);
    expect(w.player.hp).toBe(80);
    run(w, useTicks(CHIPS.recover50));
    use(w);
    expect(w.player.hp).toBe(100);
    expect(events.filter((e) => e.type === 'healed').map((e) => (e as { amount: number }).amount)).toEqual([50, 20]);
  });

  it('chips are used in queue order and consumed', () => {
    const w = makeWorld();
    give(w, 'recover50', 'cannon');
    use(w);
    expect(w.activeChip?.def.id).toBe('recover50');
    run(w, useTicks(CHIPS.recover50));
    use(w);
    expect(w.activeChip?.def.id).toBe('cannon');
    expect(w.chips.queue).toHaveLength(0);
  });

  it('locks movement for the use time and ignores presses while busy', () => {
    const w = makeWorld();
    give(w, 'cannon', 'cannon');
    use(w);
    step(w, [{ type: 'move', dir: 'left' }, { type: 'useChip' }]);
    expect(w.player.x).toBe(1);
    expect(w.chips.queue).toHaveLength(1);
    run(w, useTicks(CHIPS.cannon));
    expect(w.activeChip).toBeNull();
    step(w, [{ type: 'move', dir: 'left' }]);
    expect(w.player.x).toBe(0);
  });

  it('a Buster shot released during a chip waits until the chip ends', () => {
    const w = makeWorld();
    addEnemy(w, 1, 1);
    give(w, 'recover50');
    use(w);
    step(w, [{ type: 'busterDown' }, { type: 'busterUp' }]);
    expect(w.player.buster.shots).toBe(0);
    run(w, useTicks(CHIPS.recover50));
    expect(w.player.buster.shots).toBe(1);
  });

  it('a hit before the hit frame interrupts the chip and it is lost', () => {
    const w = makeWorld();
    const e = addEnemy(w, 1, 1);
    give(w, 'cannon');
    w.spawnAttack(new Shockwave(77, 1, 4, w.tick + 1));
    use(w);
    run(w, T(1));
    expect(e.hp).toBe(200);
    expect(w.chips.queue).toHaveLength(0);
    expect(events.some((ev) => ev.type === 'chipInterrupted')).toBe(true);
  });

  it('cannot use chips while flinched or with an empty queue', () => {
    const w = makeWorld();
    use(w);
    expect(w.activeChip).toBeNull();
    give(w, 'cannon');
    w.player.takeHit(0, w.tick);
    use(w);
    expect(w.activeChip).toBeNull();
    expect(w.chips.queue).toHaveLength(1);
  });

  it('a chip from the Custom Screen can win battle 1', () => {
    const w = new World({ seed: 2, battleIndex: 1, cheats: { god: true, aiEnabled: false } });
    run(w, T(tuning.fx.INTRO_TIME));
    // Pick the HiCannon or Cannon chips available in the lane (Mettik starts in the player's lane).
    w.chips.hand.forEach((c, i) => {
      if (c && (c.defId === 'cannon' || c.defId === 'hicannon')) w.customSelect(i);
    });
    const picked = w.chips.selection.length;
    w.customConfirm();
    run(w, T(tuning.fx.BANNER_BATTLE_START));
    for (let i = 0; i < picked; i++) {
      use(w);
      run(w, T(0.6));
    }
    // The seed-2 hand holds enough cannon damage (≥ 40) to delete the 40 HP Mettik.
    expect(picked).toBeGreaterThan(0);
    expect(w.state).toBe('BATTLE_WON');
  });
});
