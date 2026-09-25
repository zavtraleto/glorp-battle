import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { EnemyLevel } from '../src/data/enemies';
import type { Enemy, EnemyKind } from '../src/sim/enemies/enemyBase';
import { fuseProgress } from '../src/sim/enemies/telegraph';
import { World } from '../src/sim/world';

// Telegraph language (GDD §8.1): every attack exposes where it lands and a fuse
// that burns from the start of the wind-up to the strike tick.

const DT = 1 / 60;
const T = (seconds: number) => secondsToTicks(seconds);

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

function world(kind: EnemyKind, x = 1, y = 1, level: EnemyLevel = 1, aiEnabled = true): World {
  return new World({
    seed: 11,
    battleIndex: 1,
    skipIntro: true,
    cheats: { god: true, aiEnabled },
    encounter: {
      id: 'telegraph',
      tier: 'normal',
      minDepth: 1,
      maxDepth: 1,
      waves: [{ enemies: [{ kind, x, y, level }] }],
    },
  });
}

function run(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    w.step(DT, { commands: [], held: null });
    w.drainEvents();
  }
}

function placePlayer(w: World, x: number, y: number): void {
  const p = w.player;
  if (p.x !== x || p.y !== y) w.occupancy.move(p.id, p.x, p.y, x, y);
  p.x = p.prevX = x;
  p.y = p.prevY = y;
}

/** Wind-up ticks the way an enemy counts them: each phase rounded on its own. */
function windUp(kind: 'mettik' | 'hopzap' | 'bladdy'): number {
  const g = tuning[kind];
  return T(g.INTENTION_TIME) + T(g.LOCK_TIME) + T(g.COUNTER_TIME);
}

describe('telegraph fuse', () => {
  for (const kind of ['mettik', 'hopzap', 'bladdy'] as const) {
    it(`${kind}: lit at the start of INTENTION, burns out on the strike tick`, () => {
      const w = world(kind);
      const enemy = w.enemies[0] as Enemy;
      enemy.forceAttack(w.tick);
      const t0 = w.tick;
      const [tel] = w.telegraphs();
      expect(tel).toBeDefined();
      expect(tel!.start).toBe(t0);
      expect(tel!.end).toBe(t0 + windUp(kind));
      expect(fuseProgress(tel!, t0)).toBe(0);

      let last = 0;
      while (enemy.state !== 'STRIKE') {
        const now = w.telegraphs()[0];
        expect(now).toBeDefined();
        expect(now!.end).toBe(tel!.end);
        const p = fuseProgress(now!, w.tick);
        expect(p).toBeGreaterThanOrEqual(last);
        last = p;
        run(w, 1);
      }
      expect(w.tick).toBe(tel!.end);
      expect(w.telegraphs()).toEqual([]);
    });
  }

  it('Canodron: no corridor while aiming; the fuse burns through LOCK and COUNTER', () => {
    const w = world('canodron');
    const enemy = w.enemies[0] as Enemy;
    placePlayer(w, 1, 3);
    run(w, 1);
    expect(enemy.state).toBe('INTENTION');
    expect(w.telegraphs()).toEqual([]);
    while (enemy.state === 'INTENTION') run(w, 1);
    expect(enemy.state).toBe('LOCK');
    const [tel] = w.telegraphs();
    expect(tel).toMatchObject({ kind: 'lane', start: enemy.stateTick });
    expect(tel!.end).toBe(enemy.stateTick + T(tuning.canodron.LOCK_TIME) + T(tuning.canodron.COUNTER_TIME));
    expect(tel!.cells[0]).toEqual({ x: 1, y: 2 });
  });

  it('a faster level burns a shorter fuse', () => {
    const lengths = ([1, 3] as const).map((level) => {
      const w = world('mettik', 1, 1, level);
      (w.enemies[0] as Enemy).forceAttack(w.tick);
      const [tel] = w.telegraphs();
      return tel!.end - tel!.start;
    });
    expect(lengths[1]).toBeLessThan(lengths[0]!);
  });

  it('a counter puts the fuse out', () => {
    const w = world('mettik');
    const enemy = w.enemies[0] as Enemy;
    enemy.forceAttack(w.tick);
    run(w, T(tuning.mettik.INTENTION_TIME) + T(tuning.mettik.LOCK_TIME));
    expect(enemy.state).toBe('COUNTER');
    expect(enemy.counter(w.tick)).toBe(true);
    expect(w.telegraphs()).toEqual([]);
  });

  it('a collision stagger hides the fuse and resumes it where it stopped', () => {
    const w = world('bladdy');
    const enemy = w.enemies[0] as Enemy;
    enemy.forceAttack(w.tick);
    run(w, T(tuning.bladdy.INTENTION_TIME) + 3);
    expect(enemy.state).toBe('LOCK');
    const before = w.telegraphs()[0]!;
    const burnt = w.tick - before.start;
    const stagger = 10;
    enemy.applyCollisionStagger(w.tick, stagger);
    expect(w.telegraphs()).toEqual([]);
    run(w, stagger);
    const after = w.telegraphs()[0]!;
    expect(w.tick - after.start).toBe(burnt);
    expect(after.end - after.start).toBe(before.end - before.start);
  });

  it('fuseProgress clamps to 0..1 and takes sub-tick time', () => {
    const tel = { enemyId: 2, kind: 'lane' as const, cells: [], start: 10, end: 20 };
    expect(fuseProgress(tel, 0)).toBe(0);
    expect(fuseProgress(tel, 15.5)).toBeCloseTo(0.55);
    expect(fuseProgress(tel, 40)).toBe(1);
  });
});

describe('telegraph classes', () => {
  it('Mettik and Hopzap draw a lane corridor from the cell in front of them', () => {
    for (const kind of ['mettik', 'hopzap'] as const) {
      const w = world(kind);
      (w.enemies[0] as Enemy).forceAttack(w.tick);
      const [tel] = w.telegraphs();
      expect(tel!.kind).toBe('lane');
      expect(tel!.cells).toEqual([
        { x: 1, y: 2 },
        { x: 1, y: 3 },
        { x: 1, y: 4 },
        { x: 1, y: 5 },
      ]);
    }
  });

  it('Bladdy swords mark an area', () => {
    const w = world('bladdy', 1, 2);
    placePlayer(w, 2, 3);
    run(w, T(tuning.bladdy.SETTLE_TIME));
    const [tel] = w.telegraphs();
    expect(tel).toMatchObject({ kind: 'area', cells: [{ x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 }] });
  });

  it('Bladdy AreaGrab marks the row it takes as a field change', () => {
    tuning.bladdy.AREA_GRAB_DECISIONS = 1;
    const w = world('bladdy', 0, 2);
    w.placeObject('rock', 1, 2, 'enemy');
    placePlayer(w, 2, 3);
    run(w, T(tuning.bladdy.SETTLE_TIME));
    const [tel] = w.telegraphs();
    expect(tel).toMatchObject({ kind: 'grab', cells: [{ x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 }] });
  });

  it('dangerCells flattens the telegraphs', () => {
    const w = world('mettik');
    (w.enemies[0] as Enemy).forceAttack(w.tick);
    expect(w.dangerCells()).toEqual(w.telegraphs()[0]!.cells);
  });
});
