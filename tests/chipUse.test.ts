import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { Command, Dir } from '../src/core/input/commands';
import type { ChipDef, ChipId } from '../src/data/chips';
import { Shockwave } from '../src/sim/attacks/shockwave';
import { useTicks } from '../src/sim/chips/executor';
import { lobArea, lobTarget, shapeCells } from '../src/sim/chips/patterns';
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
  // Isolate chip damage from the auto Buster.
  tuning.buster.BUSTER_INTERVAL = 1e6;
  events.length = 0;
});

/** Battle with no enemies from data; tests place their own. */
function makeWorld(): World {
  const w = new World({ seed: 1, battleIndex: 1, skipIntro: true, cheats: { god: false, aiEnabled: false } });
  for (const e of w.enemies) w.occupancy.remove(e.id, e.x, e.y);
  w.enemies = [];
  // Discard the chip picked by skipIntro so each test controls the queue.
  w.chips.attack = [];
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

describe('shape geometry', () => {
  const none = () => -1;
  const at = (row: number) => () => row;

  it('near cells', () => {
    expect(shapeCells(CHIPS.sword.shape, 1, 3, none)).toEqual([{ x: 1, y: 2 }]);
    expect(shapeCells(CHIPS.widesword.shape, 1, 3, none)).toEqual([
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ]);
    expect(shapeCells(CHIPS.widesword.shape, 0, 4, none)).toEqual([
      { x: 0, y: 3 },
      { x: 1, y: 3 },
    ]);
    expect(shapeCells(CHIPS.longsword.shape, 2, 3, none)).toEqual([
      { x: 2, y: 2 },
      { x: 2, y: 1 },
    ]);
  });

  it('lob lands depth rows ahead and clips its area', () => {
    expect(lobTarget(3, 1, 3)).toEqual({ x: 1, y: 0 });
    expect(lobTarget(3, 1, 5)).toEqual({ x: 1, y: 2 });
    expect(lobTarget(3, 1, 2)).toBeNull();
    expect(lobArea([{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 }], 0, 0)).toEqual([{ x: 0, y: 0 }]);
  });

  it('lane shapes hit the first target plus cells around it', () => {
    expect(shapeCells(CHIPS.cannon.shape, 1, 4, at(1))).toEqual([{ x: 1, y: 1 }]);
    expect(shapeCells(CHIPS.shotgun.shape, 1, 4, at(1))).toEqual([
      { x: 1, y: 1 },
      { x: 1, y: 0 },
    ]);
    expect(shapeCells(CHIPS.shotgun.shape, 1, 4, at(0))).toEqual([{ x: 1, y: 0 }]);
    expect(shapeCells(CHIPS.cannon.shape, 1, 4, none)).toEqual([]);
    expect(shapeCells({ t: 'self' }, 1, 4, at(1))).toEqual([]);
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
    expect(w.chips.attackChips()).toHaveLength(0);
  });

  it('locks movement for the use time and ignores presses while busy', () => {
    const w = makeWorld();
    give(w, 'cannon', 'cannon');
    use(w);
    step(w, [{ type: 'move', dir: 'left' }, { type: 'useChip' }]);
    expect(w.player.x).toBe(1);
    expect(w.chips.attackChips()).toHaveLength(1);
    run(w, useTicks(CHIPS.cannon));
    expect(w.activeChip).toBeNull();
    step(w, [{ type: 'move', dir: 'left' }]);
    expect(w.player.x).toBe(0);
  });

  it('a hit before the hit frame interrupts the chip and it is lost', () => {
    const w = makeWorld();
    const e = addEnemy(w, 1, 1);
    give(w, 'cannon');
    w.spawnAttack(new Shockwave(77, 1, 4, w.tick + 1));
    use(w);
    run(w, T(1));
    expect(e.hp).toBe(200);
    expect(w.chips.attackChips()).toHaveLength(0);
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
    expect(w.chips.attackChips()).toHaveLength(1);
  });

  it('chips picked in battle can win battle 1', () => {
    const w = new World({ seed: 2, battleIndex: 1, cheats: { god: true, aiEnabled: false } });
    run(w, T(tuning.fx.INTRO_TIME) + 1);
    // Pick the HiCannon or Cannon chips in the lane (Mettik starts in the player's lane).
    w.chips.hand.forEach((c, i) => {
      if (c && (c.defId === 'cannon' || c.defId === 'hicannon')) w.selectChip(i);
    });
    const picked = w.chips.attack.length;
    for (let i = 0; i < picked; i++) {
      use(w);
      run(w, T(0.6));
    }
    // The seed-2 hand holds enough cannon damage (≥ 40) to delete the 40 HP Mettik.
    expect(picked).toBeGreaterThan(0);
    expect(w.state).toBe('BATTLE_WON');
  });
});

/** Uses a one-off chip definition by swapping it into the catalogue for the call. */
function withChip(def: ChipDef, fn: () => void): void {
  const saved = CHIPS[def.id];
  CHIPS[def.id] = def;
  try {
    fn();
  } finally {
    CHIPS[def.id] = saved;
  }
}

describe('hit effects', () => {
  it('push moves a hit enemy one row back unless blocked', () => {
    withChip({ ...CHIPS.cannon, onHit: { push: true } }, () => {
      const w = makeWorld();
      const e = addEnemy(w, 1, 2);
      give(w, 'cannon');
      use(w);
      run(w, hitFrame());
      expect([e.x, e.y]).toEqual([1, 1]);
      addEnemy(w, 1, 0);
      run(w, useTicks(CHIPS.cannon));
      give(w, 'cannon');
      use(w);
      run(w, hitFrame());
      expect([e.x, e.y]).toEqual([1, 1]);
    });
  });

  it('paralyze stops an enemy for PARALYZE_TIME', () => {
    withChip({ ...CHIPS.cannon, onHit: { paralyze: true } }, () => {
      const w = new World({ seed: 7, battleIndex: 1, cheats: { god: true, aiEnabled: true, buster: false }, skipIntro: true });
      w.chips.attack = [];
      const met = w.enemies[0]!; // (1,1), in the player's lane: would attack within a second
      met.hp = 500;
      give(w, 'cannon');
      use(w);
      run(w, hitFrame());
      expect(met.paralyzeTicks).toBe(T(tuning.chips.PARALYZE_TIME) - 1);
      run(w, T(tuning.chips.PARALYZE_TIME) - 2);
      expect(met.state).toBe('IDLE');
      expect(w.attacks).toHaveLength(0);
      run(w, T(tuning.mettik.MET_MOVE_INTERVAL + tuning.mettik.MET_TELEGRAPH) + 2);
      expect(w.attacks.length + (met.state === 'ATTACK' || met.state === 'RECOVERY' ? 1 : 0)).toBeGreaterThan(0);
    });
  });

  it('panel effects crack or break every cell of the area', () => {
    withChip({ ...CHIPS.widesword, onHit: { panel: 'break' } }, () => {
      const w = makeWorld();
      movePlayer(w, 1, 3);
      const e = addEnemy(w, 1, 2);
      give(w, 'widesword');
      use(w);
      run(w, hitFrame());
      expect(w.field.panel(0, 2)).toBe('BROKEN');
      expect(w.field.panel(2, 2)).toBe('BROKEN');
      expect(w.field.panel(1, 2)).toBe('CRACKED'); // the enemy still stands there
      expect(e.hp).toBe(120);
    });
  });
});

describe('player wave and invis', () => {
  it('a player wave pierces enemies up the lane and stops at a hole', () => {
    const w = makeWorld();
    const a = addEnemy(w, 1, 2);
    const b = addEnemy(w, 1, 0);
    w.field.breakPanel(1, 1, w.tick, false);
    w.spawnAttack(new Shockwave(w.nextAttackId(), 1, 3, w.tick, {
      dir: -1,
      damage: 60,
      stepTicks: T(tuning.chips.PLAYER_WAVE_STEP),
      owner: 'player',
    }));
    run(w, T(tuning.chips.PLAYER_WAVE_STEP) * 6);
    expect(a.hp).toBe(140);
    expect(b.hp).toBe(200);
    expect(w.attacks).toHaveLength(0);
  });

  it('enemy attacks pass through an invisible player', () => {
    const w = makeWorld();
    w.player.invisTicks = T(1);
    w.spawnAttack(new Shockwave(w.nextAttackId(), 1, 3, w.tick));
    expect(w.shootLane(1, 0, 10)).toBe(6);
    run(w, T(0.6));
    expect(w.player.hitsTaken).toBe(0);
  });
});

const at = (w: World, x: number, y: number) => w.enemyAt(x, y)!;

describe('new attack chips', () => {
  it('M-Cannon deals 120', () => {
    const w = makeWorld();
    const e = addEnemy(w, 1, 1, 300);
    give(w, 'mcannon');
    use(w);
    run(w, hitFrame());
    expect(e.hp).toBe(180);
  });

  it('AirShot pushes the target back', () => {
    const w = makeWorld();
    const e = addEnemy(w, 1, 2);
    give(w, 'airshot');
    use(w);
    run(w, hitFrame());
    expect([e.hp, e.y]).toEqual([180, 1]);
  });

  it('V-Gun, SideGun and Spreader hit around the target', () => {
    let w = makeWorld();
    let t = addEnemy(w, 1, 1);
    const diag = addEnemy(w, 0, 0);
    give(w, 'vgun');
    use(w);
    run(w, hitFrame());
    expect([t.hp, diag.hp, at(w, 2, 0).hp]).toEqual([170, 170, 9969]);

    w = makeWorld();
    t = addEnemy(w, 1, 1);
    const side = addEnemy(w, 2, 1);
    give(w, 'sidegun');
    use(w);
    run(w, hitFrame());
    expect([t.hp, side.hp]).toEqual([170, 170]);

    w = makeWorld();
    t = addEnemy(w, 1, 1);
    const near = addEnemy(w, 0, 2);
    give(w, 'spreader');
    use(w);
    run(w, hitFrame());
    expect([t.hp, near.hp, at(w, 2, 0).hp]).toEqual([170, 170, 9969]);
  });

  it('LilBomb hits a row of 3 and CrosBomb a cross', () => {
    let w = makeWorld();
    const row = [addEnemy(w, 0, 1), addEnemy(w, 1, 1), addEnemy(w, 2, 1)];
    const front = addEnemy(w, 1, 2);
    give(w, 'lilbomb');
    use(w);
    run(w, hitFrame() + T(tuning.chips.BOMB_FLIGHT_TIME));
    expect([...row.map((e) => e.hp), front.hp]).toEqual([150, 150, 150, 200]);

    w = makeWorld();
    const cross = [addEnemy(w, 1, 1), addEnemy(w, 0, 1), addEnemy(w, 1, 0), addEnemy(w, 1, 2)];
    const corner = addEnemy(w, 0, 0);
    give(w, 'crosbomb');
    use(w);
    run(w, hitFrame() + T(tuning.chips.BOMB_FLIGHT_TIME));
    expect([...cross.map((e) => e.hp), corner.hp]).toEqual([140, 140, 140, 140, 200]);
  });

  it('ShockWave pierces up the lane', () => {
    const w = makeWorld();
    const a = addEnemy(w, 1, 2);
    const b = addEnemy(w, 1, 0);
    give(w, 'shockwave');
    use(w);
    run(w, hitFrame() + T(tuning.chips.PLAYER_WAVE_STEP) * 6);
    expect([a.hp, b.hp]).toEqual([140, 140]);
  });

  it('Quake1 cracks the landing panel', () => {
    const w = makeWorld();
    const e = addEnemy(w, 1, 1);
    give(w, 'quake1');
    use(w);
    run(w, hitFrame() + T(tuning.chips.BOMB_FLIGHT_TIME));
    expect(e.hp).toBe(110);
    expect(w.field.panel(1, 1)).toBe('CRACKED');
  });

  it('ZapRing paralyzes', () => {
    const w = makeWorld();
    const e = addEnemy(w, 1, 1);
    give(w, 'zapring');
    use(w);
    run(w, hitFrame());
    expect(e.hp).toBe(180);
    expect(e.paralyzeTicks).toBeGreaterThan(0);
  });

  it('Recov10, Recov80 and Invis', () => {
    const w = makeWorld();
    w.player.hp = 5;
    give(w, 'recov10', 'recov80', 'invis');
    use(w);
    expect(w.player.hp).toBe(15);
    run(w, useTicks(CHIPS.recov10));
    use(w);
    expect(w.player.hp).toBe(95);
    run(w, useTicks(CHIPS.recov80));
    use(w);
    expect(w.player.invisTicks).toBe(T(tuning.chips.INVIS_TIME));
  });
});

describe('field chips', () => {
  const useNow = (w: World, id: ChipId) => {
    give(w, id);
    use(w);
    run(w, useTicks(CHIPS[id]));
  };

  it('Crack cracks the nearest enemy row', () => {
    const w = makeWorld();
    useNow(w, 'crack');
    expect([0, 1, 2].map((x) => w.field.panel(x, 2))).toEqual(['CRACKED', 'CRACKED', 'CRACKED']);
    expect(w.field.panel(1, 1)).toBe('NORMAL');
  });

  it('Geddon1 cracks every empty panel, Geddon2 breaks empty enemy panels', () => {
    let w = makeWorld();
    useNow(w, 'geddon1');
    expect(w.field.panel(0, 5)).toBe('CRACKED');
    expect(w.field.panel(0, 0)).toBe('CRACKED');
    expect(w.field.panel(1, 4)).toBe('NORMAL'); // the player
    expect(w.field.panel(2, 0)).toBe('NORMAL'); // an enemy

    w = makeWorld();
    useNow(w, 'geddon2');
    expect(w.field.panel(0, 0)).toBe('BROKEN');
    expect(w.field.panel(2, 0)).toBe('NORMAL');
    expect(w.field.panel(0, 5)).toBe('NORMAL');
  });

  it('Steal takes the free panels of the nearest enemy row', () => {
    const w = makeWorld();
    addEnemy(w, 0, 2);
    useNow(w, 'steal');
    expect([0, 1, 2].map((x) => w.field.owner(x, 2))).toEqual(['enemy', 'player', 'player']);
  });

  it('Repair fixes only the player panels', () => {
    const w = makeWorld();
    w.field.breakPanel(0, 5, w.tick, false);
    w.field.crack(2, 3);
    w.field.breakPanel(0, 0, w.tick, false);
    useNow(w, 'repair');
    expect([w.field.panel(0, 5), w.field.panel(2, 3), w.field.panel(0, 0)]).toEqual(['NORMAL', 'NORMAL', 'BROKEN']);
  });

  it('RockCube puts a rock on the free own panel in front', () => {
    const w = makeWorld();
    useNow(w, 'rockcube');
    expect(w.objectAt(1, 3)?.kind).toBe('rock');
    useNow(w, 'rockcube');
    expect(w.objects).toHaveLength(1);
    movePlayer(w, 0, 3);
    useNow(w, 'rockcube');
    expect(w.objects).toHaveLength(1); // (0,2) belongs to the enemy
  });

  it('field and support chips resolve at once', () => {
    const w = makeWorld();
    give(w, 'crack');
    use(w);
    expect(w.field.panel(1, 2)).toBe('CRACKED');
  });
});
