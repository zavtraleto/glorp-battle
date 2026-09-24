import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import { CHIPS } from '../src/data/chips';
import { chipTiming } from '../src/sim/chips/executor';
import type { SimEvent } from '../src/sim/events';
import { Shockwave } from '../src/sim/attacks/shockwave';
import { Field } from '../src/sim/field';
import { World } from '../src/sim/world';

const T = (s: number) => secondsToTicks(s);
beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

function makeField(): { f: Field; ev: SimEvent[] } {
  const ev: SimEvent[] = [];
  return { f: new Field((e) => ev.push(e)), ev };
}
const free = () => true;

describe('Field', () => {
  it('starts NORMAL with owners by row', () => {
    const { f } = makeField();
    expect(f.panel(0, 0)).toBe('NORMAL');
    expect(f.owner(2, 2)).toBe('enemy');
    expect(f.owner(0, 3)).toBe('player');
    expect(f.owner(3, 0)).toBeNull();
    expect(f.canStand('player', 1, 4)).toBe(true);
    expect(f.canStand('player', 1, 2)).toBe(false);
  });

  it('turns a cracked panel into a hole when its occupant leaves', () => {
    const { f, ev } = makeField();
    expect(f.crack(1, 4)).toBe(true);
    expect(f.panel(1, 4)).toBe('CRACKED');
    expect(f.canStand('player', 1, 4)).toBe(true);
    f.onLeave(1, 4, 10);
    expect(f.panel(1, 4)).toBe('BROKEN');
    expect(f.canStand('player', 1, 4)).toBe(false);
    expect(ev).toEqual([
      { type: 'panelChanged', x: 1, y: 4, panel: 'CRACKED', owner: 'player' },
      { type: 'panelChanged', x: 1, y: 4, panel: 'BROKEN', owner: 'player' },
    ]);
  });

  it('only cracks an occupied panel on a heavy hit', () => {
    const { f } = makeField();
    f.breakPanel(0, 3, 0, true);
    expect(f.panel(0, 3)).toBe('CRACKED');
    f.breakPanel(2, 3, 0, false);
    expect(f.panel(2, 3)).toBe('BROKEN');
  });

  it('restores holes after PANEL_RESTORE_TIME', () => {
    const { f } = makeField();
    f.breakPanel(2, 3, 100, false);
    f.update(100 + T(tuning.field.PANEL_RESTORE_TIME) - 1, free);
    expect(f.panel(2, 3)).toBe('BROKEN');
    f.update(100 + T(tuning.field.PANEL_RESTORE_TIME), free);
    expect(f.panel(2, 3)).toBe('NORMAL');
  });

  it('gives a stolen panel back when its timer ends and the panel is free', () => {
    const { f } = makeField();
    expect(f.setOwner(0, 2, 'player', 0)).toBe(true);
    expect(f.canStand('player', 0, 2)).toBe(true);
    const back = T(tuning.field.STEAL_RESTORE_TIME);
    f.update(back, () => false);
    expect(f.owner(0, 2)).toBe('player');
    f.update(back + 1, free);
    expect(f.owner(0, 2)).toBe('enemy');
  });

  it('repairs any panel', () => {
    const { f } = makeField();
    f.breakPanel(1, 5, 0, false);
    expect(f.repair(1, 5)).toBe(true);
    expect(f.panel(1, 5)).toBe('NORMAL');
    expect(f.repair(1, 5)).toBe(false);
  });
});

describe('field physics v0.1', () => {
  it('restores player-owned and world-owned panels on their owner timelines', () => {
    const { f } = makeField();
    const duration = T(1);
    f.breakPanel(0, 2, 0, duration, 'player');
    f.breakPanel(1, 2, 0, duration, 'world');

    f.update({ playerTick: duration, worldTick: duration / 2 }, { player: { x: 1, y: 4 } });

    expect(f.panel(0, 2)).toBe('NORMAL');
    expect(f.panel(1, 2)).toBe('BROKEN');
  });

  it('restores BREAK after the duration supplied by its effect', () => {
    const { f } = makeField();
    expect(f.breakPanel(1, 2, 10, T(2))).toBe(true);
    expect(f.panel(1, 2)).toBe('BROKEN');
    f.update(10 + T(2) - 1, { player: { x: 1, y: 4 } });
    expect(f.panel(1, 2)).toBe('BROKEN');
    f.update(10 + T(2), { player: { x: 1, y: 4 } });
    expect(f.panel(1, 2)).toBe('NORMAL');
  });

  it('arms a normal cell and removes its hazard exactly once', () => {
    const { f } = makeField();
    const mine = { kind: 'mine', side: 'player', damage: 6 } as const;
    expect(f.arm(0, 1, mine)).toBe(true);
    expect(f.arm(0, 1, mine)).toBe(false);
    expect(f.takeHazard(0, 1)).toEqual(mine);
    expect(f.takeHazard(0, 1)).toBeNull();
  });

  it('removes ARM when BREAK replaces its topology without changing ownership', () => {
    const { f } = makeField();
    f.arm(0, 2, { kind: 'mine', side: 'player', damage: 6 });
    expect(f.breakPanel(0, 2, 0, T(1))).toBe(true);
    expect(f.hazard(0, 2)).toBeNull();
    expect(f.owner(0, 2)).toBe('enemy');
  });

  it('keeps supporting claims until deeper claims and the player can roll back', () => {
    const { f } = makeField();
    expect(f.claimNextRow(0, T(1))).toBe(2);
    expect(f.claimNextRow(T(0.5), T(2))).toBe(1);

    f.update(T(1), { player: { x: 1, y: 3 } });
    expect(f.owner(1, 2)).toBe('player');

    f.update(T(2.5), { player: { x: 1, y: 1 } });
    expect([f.owner(1, 1), f.owner(1, 2)]).toEqual(['player', 'player']);

    f.update(T(2.5) + 1, { player: { x: 1, y: 3 } });
    expect([f.owner(1, 1), f.owner(1, 2)]).toEqual(['enemy', 'enemy']);
  });
});

const DT = 1 / 60;
function battle(): World {
  return new World({
    seed: 7,
    battleIndex: 1,
    // Long ACTION runs: the Custom Screen would open itself and freeze the tick.
    cheats: { god: true, aiEnabled: false },
    skipIntro: true,
  });
}
const stepMove = (w: World, dir: 'up' | 'down' | 'left' | 'right') =>
  w.step(DT, { commands: [{ type: 'move', dir }], held: null });
const wait = (w: World, n: number) => {
  for (let i = 0; i < n; i++) w.step(DT);
};
let uid = 8000;
/** Gives the player a chip already selected in the attack queue, then uses it. */
const useNow = (w: World, defId: 'cannon') => {
  w.giveChip({ uid: uid++, defId, code: '*', state: 'queued', deal: 0 });
  w.step(DT, { commands: [{ type: 'useChip' }], held: null });
};

describe('panels in battle', () => {
  it('blocks steps onto holes and breaks cracked panels behind the player', () => {
    const w = battle();
    w.field.breakPanel(0, 4, w.tick, false);
    stepMove(w, 'left');
    expect(w.player.x).toBe(1);
    w.field.crack(1, 4);
    stepMove(w, 'right');
    expect(w.player.x).toBe(2);
    expect(w.field.panel(1, 4)).toBe('BROKEN');
  });

  it('lets the player walk on a stolen panel', () => {
    const w = battle();
    w.field.setOwner(1, 2, 'player', w.tick);
    stepMove(w, 'up');
    wait(w, T(tuning.player.CELL_MOVE_TIME));
    stepMove(w, 'up');
    expect(w.player.y).toBe(2);
  });

  it('keeps enemies off holes', () => {
    const w = new World({ seed: 7, battleIndex: 1, cheats: { god: true, aiEnabled: true }, skipIntro: true });
    const met = w.enemies[0]!; // (1,1), steps toward the player's column
    w.occupancy.move(met.id, met.x, met.y, 2, 1);
    met.x = 2;
    w.field.breakPanel(1, 1, w.tick, false);
    wait(w, T(tuning.mettik.MOVE_TIME) + 1);
    expect(met.x).toBe(2);
  });

  it('restores holes during the battle', () => {
    const w = battle();
    w.field.breakPanel(0, 5, w.tick, false);
    wait(w, T(tuning.field.PANEL_RESTORE_TIME) + 1);
    expect(w.field.panel(0, 5)).toBe('NORMAL');
  });

  it('stops a wave at a hole', () => {
    const w = battle();
    w.player.iframeTicks = 0;
    w.field.breakPanel(1, 3, w.tick, false);
    const wave = new Shockwave(w.nextAttackId(), 1, 2, w.tick);
    w.spawnAttack(wave);
    wait(w, T(tuning.projectile.CELL_TRAVEL_TIME) * 4);
    expect(wave.done).toBe(true);
    expect(w.player.hitsTaken).toBe(0);
  });
});

describe('field objects', () => {
  it('places a rock only on a free standable cell', () => {
    const w = battle();
    expect(w.placeObject('rock', 1, 4, 'player')).toBeNull(); // the player stands there
    const rock = w.placeObject('rock', 1, 3, 'player')!;
    expect(rock.hp).toBe(tuning.field.ROCK_HP);
    expect(w.occupancy.isFree(1, 3)).toBe(false);
    w.field.breakPanel(0, 3, w.tick, false);
    expect(w.placeObject('rock', 0, 3, 'player')).toBeNull();
  });

  it('stops chips and enemy shots, and breaks at 0 HP', () => {
    const w = new World({ seed: 7, battleIndex: 1, cheats: { god: true, aiEnabled: false }, skipIntro: true });
    const rock = w.placeObject('rock', 1, 3, 'player')!;
    const met = w.enemies[0]!; // (1,1), behind the rock in the player's lane
    useNow(w, 'cannon');
    wait(w, chipTiming(CHIPS.cannon).startupTicks + 1);
    expect(met.hp).toBe(tuning.mettik.MET_HP);
    expect(rock.hp).toBe(tuning.field.ROCK_HP - CHIPS.cannon.power!);
    expect(w.shootLane(1, 2, 500)).toBe(3);
    expect(rock.alive).toBe(false);
    expect(w.objects).toHaveLength(0);
    expect(w.occupancy.isFree(1, 3)).toBe(true);
    expect(w.drainEvents().some((e) => e.type === 'objectBroken')).toBe(true);
  });

  it('stops a wave on a rock', () => {
    const w = battle();
    const rock = w.placeObject('rock', 1, 3, 'player')!;
    const wave = new Shockwave(w.nextAttackId(), 1, 2, w.tick);
    w.spawnAttack(wave);
    wait(w, T(tuning.projectile.CELL_TRAVEL_TIME) * 4);
    expect(wave.done).toBe(true);
    expect(rock.hp).toBe(tuning.field.ROCK_HP - tuning.mettik.MET_DMG);
    expect(w.player.hitsTaken).toBe(0);
  });
});
