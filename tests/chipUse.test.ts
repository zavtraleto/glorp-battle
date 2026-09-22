import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { Command, Dir } from '../src/core/input/commands';
import type { ChipDef, ChipId } from '../src/data/chips';
import { Shockwave } from '../src/sim/attacks/shockwave';
import { useTicks } from '../src/sim/chips/executor';
import { lobArea, lobTarget, shapeCells } from '../src/sim/chips/patterns';
import type { Enemy } from '../src/sim/enemies/enemyBase';
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
  for (const defId of ids) w.giveChip({ uid: uid++, defId, code: '*', state: 'queued', deal: 0 });
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

function moveEnemyTo(w: World, e: Enemy, x: number, y: number): void {
  w.occupancy.move(e.id, e.x, e.y, x, y);
  e.x = e.prevX = x;
  e.y = e.prevY = y;
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
  it('lets the player move during a frozen chip series and aims each link from its start cell', () => {
    const w = makeWorld();
    const firstLane = addEnemy(w, 1, 2, 200);
    const secondLane = addEnemy(w, 0, 2, 200);
    give(w, 'cannon', 'cannon');

    use(w);
    step(w, [{ type: 'move', dir: 'left' }]);
    expect([w.player.x, w.player.y]).toEqual([0, 4]);

    run(w, hitFrame() - 1);
    expect([firstLane.hp, secondLane.hp]).toEqual([160, 200]);

    const chainDelay = T(tuning.chips.CHIP_CHAIN_DELAY);
    run(w, useTicks(CHIPS.cannon) - hitFrame() + chainDelay + hitFrame());
    expect([firstLane.hp, secondLane.hp]).toEqual([160, 160]);
  });

  it('keeps every Vulcan hit on the lane captured when Vulcan starts', () => {
    const w = makeWorld();
    const target = addEnemy(w, 1, 2, 200);
    give(w, 'vulcan');

    use(w);
    step(w, [{ type: 'move', dir: 'left' }]);
    run(w, hitFrame() + 2 * T(tuning.chips.VULCAN_HIT_STEP) - 1);

    expect([w.player.x, target.hp]).toEqual([0, 170]);
  });

  it('counters a telegraph hit in its final window, staggers the enemy, and continues the series', () => {
    const w = makeWorld();
    const met = addEnemy(w, 1, 2, 200);
    const counter = tuning as unknown as {
      counter: { COUNTER_WINDOW_METTIK: number; COUNTER_STAGGER_TIME: number };
    };
    met.setState('TELEGRAPH', w.tick);
    met.stateTick -= T(tuning.mettik.MET_TELEGRAPH - counter.counter.COUNTER_WINDOW_METTIK);
    give(w, 'cannon', 'cannon');

    use(w);
    run(w, hitFrame());
    expect(met.state).toBe('STAGGER');
    expect(events.some((event) => event.type === 'enemyCountered')).toBe(true);

    run(w, useTicks(CHIPS.cannon) - hitFrame() + T(tuning.chips.CHIP_CHAIN_DELAY) + hitFrame());
    expect(met.hp).toBe(120);

    run(w, T(counter.counter.COUNTER_STAGGER_TIME));
    expect(met.state).toBe('IDLE');
  });

  it('does not counter a hit before the counter window opens', () => {
    const w = makeWorld();
    const met = addEnemy(w, 1, 2, 200);
    met.setState('TELEGRAPH', w.tick);
    give(w, 'cannon');

    use(w);
    run(w, hitFrame());

    expect(met.state).toBe('TELEGRAPH');
    expect(events.some((event) => event.type === 'enemyCountered')).toBe(false);
  });

  it('Vulcan resolves three separate hits and retargets after a kill', () => {
    const w = makeWorld();
    const front = addEnemy(w, 1, 2, 20);
    const back = addEnemy(w, 1, 0, 200);
    give(w, 'vulcan');
    use(w);

    run(w, hitFrame());
    expect([front.hp, back.hp]).toEqual([10, 200]);
    run(w, T(tuning.chips.VULCAN_HIT_STEP));
    expect([front.hp, back.hp]).toEqual([0, 200]);
    run(w, T(tuning.chips.VULCAN_HIT_STEP));
    expect([front.hp, back.hp]).toEqual([0, 190]);
  });

  it('Vulcan misses the rest of its burst when the target leaves the lane', () => {
    const w = makeWorld();
    const target = addEnemy(w, 1, 2, 200);
    give(w, 'vulcan');
    use(w);

    run(w, hitFrame());
    expect(target.hp).toBe(190);
    moveEnemyTo(w, target, 0, 2);
    run(w, T(tuning.chips.VULCAN_HIT_STEP) * 2);
    expect(target.hp).toBe(190);
  });

  it('Barrier absorbs the next hit without flinch, i-frames, or interrupting a chip', () => {
    const w = makeWorld();
    give(w, 'barrier');
    use(w);
    run(w, useTicks(CHIPS.barrier));
    expect(w.player.barrier).toBe(true);

    give(w, 'cannon');
    use(w);
    const cannon = w.activeChip;
    const hit = { id: -80, kind: 'instant', hitIds: new Set<number>(), done: true, update: () => undefined };
    expect(w.hitPlayerAt(hit, w.player.x, w.player.y, 80)).toBe(true);

    expect(w.player.barrier).toBe(false);
    expect(w.player.hp).toBe(w.player.maxHp);
    expect(w.player.hitsTaken).toBe(0);
    expect(w.player.flinchTicks).toBe(0);
    expect(w.player.iframeTicks).toBe(0);
    expect(w.activeChip).toBe(cannon);
    expect(events.some((e) => e.type === 'chipInterrupted')).toBe(false);
  });

  it('using Barrier twice still absorbs only one hit', () => {
    const w = makeWorld();
    give(w, 'barrier');
    use(w);
    run(w, useTicks(CHIPS.barrier));
    give(w, 'barrier');
    use(w);
    run(w, useTicks(CHIPS.barrier));

    const first = { id: -81, kind: 'instant', hitIds: new Set<number>(), done: true, update: () => undefined };
    const second = { id: -82, kind: 'instant', hitIds: new Set<number>(), done: true, update: () => undefined };
    expect(w.hitPlayerAt(first, w.player.x, w.player.y, 10)).toBe(true);
    expect(w.player.hp).toBe(100);
    expect(w.hitPlayerAt(second, w.player.x, w.player.y, 10)).toBe(true);
    expect(w.player.hp).toBe(90);
  });

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

  it('HiCannon deals 60 (MMBN3)', () => {
    const w = makeWorld();
    const e = addEnemy(w, 1, 1);
    give(w, 'hicannon');
    use(w);
    run(w, hitFrame());
    expect(e.hp).toBe(140);
  });

  it('Sword only reaches the adjacent panel', () => {
    const w = makeWorld();
    const e = addEnemy(w, 1, 2);
    give(w, 'sword', 'sword');
    use(w); // from (1,4): hits (1,3) → miss
    run(w, useTicks(CHIPS.sword));
    expect(e.hp).toBe(200);
    movePlayer(w, 1, 3);
    run(w, T(tuning.chips.CHIP_CHAIN_DELAY) + hitFrame());
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
    run(w, useTicks(CHIPS.recover50) + T(tuning.chips.CHIP_CHAIN_DELAY));
    expect(w.player.hp).toBe(100);
    expect(events.filter((e) => e.type === 'healed').map((e) => (e as { amount: number }).amount)).toEqual([50, 20]);
  });

  it('one attack command uses the frozen chip selection in order', () => {
    const w = makeWorld();
    give(w, 'recover50', 'cannon');
    use(w);
    expect(w.activeChip?.def.id).toBe('recover50');
    run(w, useTicks(CHIPS.recover50) + T(tuning.chips.CHIP_CHAIN_DELAY));
    expect(w.activeChip?.def.id).toBe('cannon');
    expect(w.chips.attackChips()).toHaveLength(0);
  });

  it('does not allow the frozen selection to change while the chain is running', () => {
    const w = makeWorld();
    give(w, 'recover50', 'cannon', 'cannon');
    const readyChip = w.chips.attackChips()[2]!;
    const readySlot = w.chips.hand.indexOf(readyChip);
    expect(w.selectChip(readySlot)).toBe(true);
    use(w);
    expect(w.selectChip(readySlot)).toBe(false);
  });

  it('allows movement for the whole automatic chain and ignores extra attack presses', () => {
    const w = makeWorld();
    give(w, 'cannon', 'cannon');
    use(w);
    step(w, [{ type: 'move', dir: 'left' }, { type: 'useChip' }]);
    expect(w.player.x).toBe(0);
    expect(w.chips.attackChips()).toHaveLength(1);
    run(w, useTicks(CHIPS.cannon) + T(tuning.chips.CHIP_CHAIN_DELAY));
    expect(w.activeChip?.def.id).toBe('cannon');
    step(w, [{ type: 'move', dir: 'right' }, { type: 'useChip' }]);
    expect(w.player.x).toBe(1);
    run(w, useTicks(CHIPS.cannon));
    step(w, [{ type: 'move', dir: 'left' }]);
    expect(w.player.x).toBe(0);
  });

  it('allows movement on the exact tick between chained chips', () => {
    const w = makeWorld();
    give(w, 'cannon', 'cannon');
    use(w);
    run(w, useTicks(CHIPS.cannon) - 1);
    step(w, [{ type: 'move', dir: 'left' }]);
    expect(w.player.x).toBe(0);
    expect(w.activeChip).toBeNull();
  });

  it('honors a positive chain delay while keeping movement available', () => {
    tuning.chips.CHIP_CHAIN_DELAY = 0.2;
    const w = makeWorld();
    give(w, 'cannon', 'cannon');
    use(w);
    run(w, useTicks(CHIPS.cannon));
    expect(w.activeChip).toBeNull();
    step(w, [{ type: 'move', dir: 'left' }]);
    expect(w.player.x).toBe(0);
    run(w, T(0.2) - 2);
    expect(w.activeChip).toBeNull();
    run(w, 1);
    expect(w.activeChip?.def.id).toBe('cannon');
  });

  it('a hit before the hit frame returns the chip and clears the frozen queue', () => {
    const w = makeWorld();
    const e = addEnemy(w, 1, 1);
    give(w, 'cannon', 'cannon');
    const [fired, waiting] = w.chips.attackChips();
    const firedSlot = w.chips.hand.indexOf(fired!);
    const waitingSlot = w.chips.hand.indexOf(waiting!);
    w.spawnAttack(new Shockwave(77, 1, 4, w.tick + 1));
    use(w);
    run(w, T(1));
    expect(e.hp).toBe(200);
    expect(w.chips.attackChips()).toHaveLength(0);
    expect(w.chips.hand[firedSlot]).toBe(fired);
    expect(w.chips.hand[waitingSlot]).toBe(waiting);
    expect(fired?.state).toBe('hand');
    expect(w.chips.coolingCount).toBe(0);
    const cancelled = events.find((ev) => ev.type === 'chipChainCancelled');
    expect(cancelled?.type === 'chipChainCancelled' ? cancelled.chips.map((chip) => chip.slot) : []).toEqual([firedSlot, waitingSlot]);
    expect(events.some((ev) => ev.type === 'chipInterrupted')).toBe(true);
  });

  it('reserves the visible replacement only after the outgoing chip resolves', () => {
    const w = makeWorld();
    give(w, 'cannon');
    const fired = w.chips.attackChips()[0]!;
    const slot = w.chips.hand.indexOf(fired);
    const next = w.chips.drawPreview(1)[0]!;

    use(w);
    expect(w.chips.pendingChip(slot)).toBeNull();
    run(w, hitFrame() - 1);
    expect(w.chips.pendingChip(slot)).toBeNull();
    run(w, 1);
    expect(w.chips.pendingChip(slot)).toBe(next);
    expect(w.chips.drawPreview(5)).not.toContain(next);
  });

  it('reserves the active slot for a possible return even with a zero cooldown', () => {
    withChip({ ...CHIPS.cannon, cooldown: 0 } as ChipDef & { cooldown: number }, () => {
      const w = makeWorld();
      give(w, 'cannon');
      const fired = w.chips.attackChips()[0]!;
      const slot = w.chips.hand.indexOf(fired);
      use(w);
      // Give the zero cooldown a refill opportunity before interrupting the
      // still-unresolved cannon.
      run(w, 1);
      const hit = { id: -76, kind: 'instant', hitIds: new Set<number>(), done: true, update: () => undefined };
      expect(w.hitPlayerAt(hit, w.player.x, w.player.y, 1)).toBe(true);
      expect(w.chips.hand[slot]).toBe(fired);
      expect(fired.state).toBe('hand');
      expect(w.chips.coolingCount).toBe(0);
    });
  });

  it('a hit after the hit frame spends the active chip and cancels only chips that have not started', () => {
    const w = makeWorld();
    const e = addEnemy(w, 1, 1);
    give(w, 'cannon', 'cannon');
    const fired = w.chips.attackChips()[0]!;
    const firedSlot = w.chips.hand.indexOf(fired);
    const second = w.chips.attackChips()[1]!;
    const secondSlot = w.chips.hand.indexOf(second);
    use(w);
    run(w, hitFrame());
    expect(e.hp).toBe(160);
    w.spawnAttack(new Shockwave(78, 1, 4, w.tick + 1));
    run(w, 1);
    expect(w.activeChip).toBeNull();
    expect(w.chips.attack).toEqual([]);
    expect(w.chips.hand[firedSlot]).toBeNull();
    expect(w.chips.hand[secondSlot]).toBe(second);
    expect(w.chips.slotState(secondSlot)).toBe('ready');
    expect(w.chips.hand.includes(fired)).toBe(false);
    expect(fired.state).toBe('used');
    const cancelled = events.find((ev) => ev.type === 'chipChainCancelled');
    expect(cancelled?.type === 'chipChainCancelled' ? cancelled.chips.map((chip) => chip.slot) : []).toEqual([secondSlot]);
  });

  it('cancels and signals every remaining chip when hit during the chain delay', () => {
    tuning.chips.CHIP_CHAIN_DELAY = 0.2;
    const w = makeWorld();
    give(w, 'cannon', 'cannon');
    const waiting = w.chips.attackChips()[1]!;
    const waitingSlot = w.chips.hand.indexOf(waiting);
    use(w);
    run(w, useTicks(CHIPS.cannon));
    expect(w.activeChip).toBeNull();
    w.spawnAttack(new Shockwave(79, 1, 4, w.tick + 1));
    run(w, 1);
    expect(w.chips.attack).toEqual([]);
    expect(w.chips.hand[waitingSlot]).toBe(waiting);
    const cancelled = events.find((ev) => ev.type === 'chipChainCancelled');
    expect(cancelled?.type === 'chipChainCancelled' ? cancelled.chips.map((chip) => chip.slot) : []).toEqual([waitingSlot]);
  });

  it('refills each spent slot two seconds after that chip starts', () => {
    const w = makeWorld();
    give(w, 'cannon');
    const fired = w.chips.attackChips()[0]!;
    const slot = w.chips.hand.indexOf(fired);
    use(w);
    expect(w.chips.hand[slot]).toBeNull();
    run(w, T(2) - 1);
    expect(w.chips.hand[slot]).toBeNull();
    run(w, 1);
    expect(w.chips.hand[slot]).not.toBeNull();
  });

  it('allows a chip definition to override the common refill cooldown', () => {
    withChip({ ...CHIPS.cannon, cooldown: 0.5 } as ChipDef & { cooldown: number }, () => {
      const w = makeWorld();
      give(w, 'cannon');
      const fired = w.chips.attackChips()[0]!;
      const slot = w.chips.hand.indexOf(fired);
      use(w);
      run(w, T(0.5) - 1);
      expect(w.chips.hand[slot]).toBeNull();
      run(w, 1);
      expect(w.chips.hand[slot]).not.toBeNull();
    });
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
      const w = new World({ seed: 7, battleIndex: 1, cheats: { god: true, aiEnabled: true }, skipIntro: true });
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
  it('M-Cannon deals 80 (MMBN3)', () => {
    const w = makeWorld();
    const e = addEnemy(w, 1, 1, 300);
    give(w, 'mcannon');
    use(w);
    run(w, hitFrame());
    expect(e.hp).toBe(220);
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

  it('ShockWave pierces up the lane', () => {
    const w = makeWorld();
    const a = addEnemy(w, 1, 2);
    const b = addEnemy(w, 1, 0);
    give(w, 'shockwave');
    use(w);
    run(w, hitFrame() + T(tuning.chips.PLAYER_WAVE_STEP) * 6);
    expect([a.hp, b.hp]).toEqual([140, 140]);
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
    run(w, useTicks(CHIPS.recov10) + T(tuning.chips.CHIP_CHAIN_DELAY));
    expect(w.player.hp).toBe(95);
    run(w, useTicks(CHIPS.recov80) + T(tuning.chips.CHIP_CHAIN_DELAY));
    expect(w.player.invisTicks).toBe(T(tuning.chips.INVIS_TIME));
  });
});

describe('field chips', () => {
  const useNow = (w: World, id: ChipId) => {
    give(w, id);
    use(w);
    run(w, useTicks(CHIPS[id]));
  };

  it('PanlGrab takes the nearest free enemy panel in the player lane', () => {
    const w = makeWorld(); // player at (1,4), the durable enemy sits away from x=1
    useNow(w, 'panlgrab');
    expect(w.field.owner(1, 2)).toBe('player');
    expect(w.field.owner(0, 2)).toBe('enemy');
  });

  it('PanlOut1 breaks the panel right in front', () => {
    const w = makeWorld();
    w.player.y = 3; // standing on the border row: the panel ahead is the enemy's (1,2)
    useNow(w, 'panlout1');
    expect(w.field.panel(1, 2)).toBe('BROKEN');
  });

  it('PanlOut3 breaks the row of three in front, cracks occupied ones', () => {
    const w = makeWorld();
    w.player.y = 3;
    const e = w.enemies[0]!;
    moveEnemyTo(w, e, 0, 2);
    useNow(w, 'panlout3');
    expect(w.field.panel(0, 2)).toBe('CRACKED');
    expect(w.field.panel(1, 2)).toBe('BROKEN');
    expect(w.field.panel(2, 2)).toBe('BROKEN');
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

  it('AreaGrab takes the free panels of the nearest enemy row', () => {
    const w = makeWorld();
    addEnemy(w, 0, 2);
    useNow(w, 'areagrab');
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
    give(w, 'panlout1');
    use(w);
    expect(w.field.panel(1, 3)).toBe('BROKEN');
  });
});
