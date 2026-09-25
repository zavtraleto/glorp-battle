import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, tuning } from '../src/config/tuning';
import type { FolderChip } from '../src/sim/chips/chipSystem';
import type { Command } from '../src/core/input/commands';
import { World } from '../src/sim/world';

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

const FOLDER: FolderChip[] = [
  { defId: 'cannon' },
  { defId: 'cannon' },
  { defId: 'sword' },
  { defId: 'areagrab' },
];

function world(hand?: (FolderChip | null)[]): World {
  return new World({
    seed: 3,
    battleIndex: 1,
    skipIntro: true,
    cheats: { god: false, aiEnabled: false },
    folder: FOLDER,
    hand,
  });
}

describe('exact hand', () => {
  it('puts the named chips in the named slots and leaves the rest empty', () => {
    const w = world([null, null, { defId: 'sword' }, null, null]);
    expect(w.chips.hand.map((c) => c?.defId ?? null)).toEqual([null, null, 'sword', null, null]);
    expect(w.chips.hand[2]?.deal).toBeGreaterThan(0);
  });

  it('does not take the same folder chip twice', () => {
    const w = world([{ defId: 'cannon' }, { defId: 'cannon' }, null, null, null]);
    expect(w.chips.hand[0]?.uid).not.toBe(w.chips.hand[1]?.uid);
  });

  it('deals a chip into an empty slot mid-battle, unselected, with a fresh deal serial', () => {
    const w = world([null, null, null, null, null]);
    const before = w.chips.hand[2];
    expect(before).toBeNull();
    expect(w.dealChip(2, { defId: 'cannon' })).toBe(true);
    expect(w.chips.hand[2]?.defId).toBe('cannon');
    expect(w.chips.slotState(2)).toBe('ready');
    expect(w.chips.attack).toEqual([]);
  });

  it('refuses to deal into an occupied slot', () => {
    const w = world([{ defId: 'sword' }, null, null, null, null]);
    expect(w.dealChip(0, { defId: 'cannon' })).toBe(false);
  });

  it('keeps dealing the rest of the folder as spent slots refill', () => {
    const w = world([{ defId: 'cannon' }, null, null, null, null]);
    expect(w.chips.drawRemaining).toBe(FOLDER.length - 1);
  });
});

describe('noKo', () => {
  it('floors the player at 1 HP but still reports the hit', () => {
    const w = new World({
      seed: 3,
      battleIndex: 1,
      skipIntro: true,
      cheats: { god: false, aiEnabled: false, noKo: true },
      folder: FOLDER,
    });
    const p = w.player;
    p.hp = 5;
    p.iframeTicks = 0;
    const attack = { id: -2, kind: 'instant', hitIds: new Set<number>(), done: true, update: () => undefined };
    expect(w.hitPlayerAt(attack, p.x, p.y, 40)).toBe(true);
    expect(p.hp).toBe(1);
    expect(p.alive).toBe(true);
    expect(p.hitsTaken).toBe(1);
  });

  it('leaves normal damage alone', () => {
    const w = new World({
      seed: 3,
      battleIndex: 1,
      skipIntro: true,
      cheats: { god: false, aiEnabled: false },
      folder: FOLDER,
    });
    const p = w.player;
    p.hp = 5;
    p.iframeTicks = 0;
    const attack = { id: -2, kind: 'instant', hitIds: new Set<number>(), done: true, update: () => undefined };
    w.hitPlayerAt(attack, p.x, p.y, 40);
    expect(p.hp).toBe(0);
    expect(p.alive).toBe(false);
  });
});

describe('tutorial hold', () => {
  const step = (w: World, commands: Command[] = []) => w.step(1 / 60, { commands, held: null });

  it('freezes ACTION: no clock, no enemy, no chip, until the asked-for command', () => {
    const w = world([{ defId: 'cannon' }, null, null, null, null]);
    w.hold = { move: true };
    const time = w.time;
    step(w, [{ type: 'useChip' }, { type: 'selectChip', slot: 0 }]);
    for (let i = 0; i < 30; i++) step(w);
    expect(w.time).toBe(time);
    expect(w.simFrozen).toBe(true);
    expect(w.chips.attack).toEqual([]);
    step(w, [{ type: 'move', dir: 'left' }]);
    expect(w.hold).toBeNull();
    expect(w.player.x).toBe(tuning.player.PLAYER_START_X - 1);
    expect(w.time).toBeGreaterThan(time);
  });

  it('keeps the hold when the step runs into the edge of the field', () => {
    const w = world();
    w.hold = { move: true };
    step(w, [{ type: 'move', dir: 'left' }]);
    w.hold = { move: true };
    for (let i = 0; i < 30; i++) step(w);
    step(w, [{ type: 'move', dir: 'left' }]);
    expect(w.player.x).toBe(0);
    expect(w.hold).toEqual({ move: true });
  });

  it('lets taps on the named slots through and keeps holding', () => {
    const w = world([{ defId: 'cannon' }, { defId: 'cannon' }, null, null, null]);
    w.hold = { slots: [1] };
    step(w, [{ type: 'selectChip', slot: 0 }, { type: 'selectChip', slot: 1 }]);
    expect(w.chips.attack).toEqual([1]);
    expect(w.hold).toEqual({ slots: [1] });
  });

  it('an Attack press lifts an attack hold and fires on the same tick', () => {
    const w = world([{ defId: 'cannon' }, null, null, null, null]);
    w.selectChip(0);
    w.hold = { attack: true };
    step(w, [{ type: 'useChip' }]);
    expect(w.hold).toBeNull();
    expect(w.activeChip?.def.id).toBe('cannon');
  });
});

describe('lesson folder', () => {
  it('replaces the folder and the hand; new cassettes get new uids', () => {
    const w = world([{ defId: 'cannon' }, null, null, null, null]);
    const old = w.chips.hand[0]!.uid;
    w.setFolder([{ defId: 'sword' }, { defId: 'areagrab' }], [
      { defId: 'areagrab' },
      { defId: 'sword' },
      null,
      null,
      null,
    ]);
    expect(w.chips.hand.map((c) => c?.defId ?? null)).toEqual(['areagrab', 'sword', null, null, null]);
    expect(w.chips.chips).toHaveLength(2);
    expect(w.chips.hand[0]!.uid).toBeGreaterThan(old);
    expect(w.chips.drawRemaining).toBe(0);
  });
});
