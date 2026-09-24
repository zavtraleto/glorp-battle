import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, tuning } from '../src/config/tuning';
import type { FolderChip } from '../src/sim/chips/chipSystem';
import { World } from '../src/sim/world';

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

const FOLDER: FolderChip[] = [
  { defId: 'cannon', code: 'A' },
  { defId: 'cannon', code: 'A' },
  { defId: 'sword', code: 'L' },
  { defId: 'areagrab', code: 'L' },
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
    const w = world([null, null, { defId: 'sword', code: 'L' }, null, null]);
    expect(w.chips.hand.map((c) => c?.defId ?? null)).toEqual([null, null, 'sword', null, null]);
    expect(w.chips.hand[2]?.code).toBe('L');
    expect(w.chips.hand[2]?.deal).toBeGreaterThan(0);
  });

  it('does not take the same folder chip twice', () => {
    const w = world([{ defId: 'cannon', code: 'A' }, { defId: 'cannon', code: 'A' }, null, null, null]);
    expect(w.chips.hand[0]?.uid).not.toBe(w.chips.hand[1]?.uid);
  });

  it('deals a chip into an empty slot mid-battle, unselected, with a fresh deal serial', () => {
    const w = world([null, null, null, null, null]);
    const before = w.chips.hand[2];
    expect(before).toBeNull();
    expect(w.dealChip(2, { defId: 'cannon', code: 'A' })).toBe(true);
    expect(w.chips.hand[2]?.defId).toBe('cannon');
    expect(w.chips.slotState(2)).toBe('ready');
    expect(w.chips.attack).toEqual([]);
  });

  it('refuses to deal into an occupied slot', () => {
    const w = world([{ defId: 'sword', code: 'L' }, null, null, null, null]);
    expect(w.dealChip(0, { defId: 'cannon', code: 'A' })).toBe(false);
  });

  it('keeps dealing the rest of the folder as spent slots refill', () => {
    const w = world([{ defId: 'cannon', code: 'A' }, null, null, null, null]);
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
