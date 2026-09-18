import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, tuning } from '../src/config/tuning';
import { Rng } from '../src/core/rng';
import type { ChipCode, ChipId } from '../src/data/chips';
import { ChipSystem, type FolderChip } from '../src/sim/chips/chipSystem';

// Real-time hand, Attack Queue and Refresh (GDD §5, §7). No Custom Screen: the
// player builds a series while the battle runs.

beforeEach(() => {
  mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING)));
});

const chip = (defId: ChipId, code: ChipCode): FolderChip => ({ defId, code });

function sys(list: FolderChip[], seed = 5): ChipSystem {
  const s = new ChipSystem(list, new Rng(seed));
  s.dealHand();
  return s;
}

/** Hand slot holding the first chip that matches, or -1. */
function slotOf(s: ChipSystem, defId: ChipId, code: ChipCode): number {
  return s.hand.findIndex((c) => c !== null && c.defId === defId && c.code === code);
}

const FIVE: FolderChip[] = [
  chip('cannon', 'A'),
  chip('cannon', 'F'),
  chip('recover50', 'F'),
  chip('sword', 'B'),
  chip('shotgun', 'A'),
];

const TEN: FolderChip[] = [...FIVE, ...FIVE.map((c) => ({ ...c }))];

describe('hand', () => {
  it('deals exactly HAND_SIZE chips at the start of the battle', () => {
    const s = sys(TEN);
    expect(s.hand).toHaveLength(tuning.chips.HAND_SIZE);
    expect(s.hand.every((c) => c !== null)).toBe(true);
    expect(s.drawRemaining).toBe(TEN.length - tuning.chips.HAND_SIZE);
  });

  it('leaves slots empty when the folder runs short', () => {
    const s = sys([chip('cannon', 'A'), chip('sword', 'B')]);
    expect(s.hand.filter((c) => c !== null)).toHaveLength(2);
    expect(s.slotState(4)).toBe('empty');
  });

  it('shows the next chips of the draw queue', () => {
    const s = sys(TEN);
    expect(s.drawPreview(3)).toHaveLength(3);
    expect(s.drawPreview(99)).toHaveLength(TEN.length - tuning.chips.HAND_SIZE);
  });
});

describe('attack queue', () => {
  it('adds a tapped chip at the end and numbers it', () => {
    const s = sys(FIVE);
    const a = slotOf(s, 'cannon', 'A');
    const b = slotOf(s, 'shotgun', 'A');
    expect(s.toggleSelect(a)).toBe(true);
    expect(s.toggleSelect(b)).toBe(true);
    expect(s.attack).toEqual([a, b]);
    expect(s.queuePosition(a)).toBe(1);
    expect(s.queuePosition(b)).toBe(2);
    expect(s.slotState(a)).toBe('queued');
  });

  it('takes a chip back out before the first shot', () => {
    const s = sys(FIVE);
    const a = slotOf(s, 'cannon', 'A');
    s.toggleSelect(a);
    expect(s.toggleSelect(a)).toBe(true);
    expect(s.attack).toEqual([]);
    expect(s.slotState(a)).toBe('ready');
  });

  it('locks the series once the first chip has been fired', () => {
    const s = sys(FIVE);
    const a = slotOf(s, 'cannon', 'A');
    const b = slotOf(s, 'shotgun', 'A');
    s.toggleSelect(a);
    s.toggleSelect(b);
    s.takeNext();
    expect(s.locked).toBe(true);
    expect(s.toggleSelect(b)).toBe(false);
    expect(s.attack).toEqual([b]);
  });

  it('can hold the whole hand when every code matches', () => {
    const s = sys([chip('cannon', 'A'), chip('shotgun', 'A'), chip('vgun', 'A'), chip('spreader', 'A'), chip('airshot', '*')]);
    for (let i = 0; i < 5; i++) s.toggleSelect(i);
    expect(s.attack).toHaveLength(tuning.chips.HAND_SIZE);
    for (let i = 0; i < 5; i++) expect(s.slotState(i)).toBe('queued');
  });
});

describe('code rule', () => {
  it('blocks incompatible chips the moment the first one is picked', () => {
    const s = sys(FIVE);
    const sword = slotOf(s, 'sword', 'B');
    expect(s.slotState(sword)).toBe('ready');
    s.toggleSelect(slotOf(s, 'cannon', 'A'));
    expect(s.slotState(sword)).toBe('blocked');
    expect(s.slotState(slotOf(s, 'shotgun', 'A'))).toBe('ready');
    expect(s.toggleSelect(sword)).toBe(false);
  });

  // The rule belongs to the whole series, not to the chips still unfired.
  it('remembers the rule across shots of the same series', () => {
    const s = sys(FIVE);
    // Same name: Cannon A + Cannon F.
    s.toggleSelect(slotOf(s, 'cannon', 'A'));
    s.toggleSelect(slotOf(s, 'cannon', 'F'));
    s.takeNext(); // Cannon A is gone; only Cannon F is left queued
    // Recover50 F shares a code with what is left, but not with the series.
    expect(s.toggleSelect(slotOf(s, 'recover50', 'F'))).toBe(false);
  });

  it('resets the rule once the series is spent', () => {
    const s = sys(FIVE);
    s.toggleSelect(slotOf(s, 'cannon', 'A'));
    s.takeNext();
    expect(s.locked).toBe(false);
    const sword = slotOf(s, 'sword', 'B');
    expect(s.slotState(sword)).toBe('ready');
    expect(s.toggleSelect(sword)).toBe(true);
  });
});

describe('refresh', () => {
  it('empties the slot of a fired chip and counts it', () => {
    const s = sys(TEN);
    s.toggleSelect(0);
    const fired = s.takeNext();
    expect(fired?.state).toBe('used');
    expect(s.hand[0]).toBeNull();
    expect(s.slotState(0)).toBe('empty');
    expect(s.usedSinceRefresh).toBe(1);
  });

  it('comes due at REFRESH_AT and refills every empty slot', () => {
    const s = sys(TEN);
    const before = s.drawRemaining;
    for (let i = 0; i < tuning.chips.REFRESH_AT; i++) {
      const slot = s.hand.findIndex((c) => c !== null);
      s.toggleSelect(slot);
      s.takeNext(); // the queue empties, so the series rule resets by itself
    }
    expect(s.refreshDue).toBe(true);
    s.refresh();
    expect(s.refreshDue).toBe(false);
    expect(s.usedSinceRefresh).toBe(0);
    expect(s.hand.every((c) => c !== null)).toBe(true);
    expect(s.drawRemaining).toBe(before - tuning.chips.REFRESH_AT);
  });

  it('leaves untouched chips where they are', () => {
    const s = sys(TEN);
    const keep = s.hand[4];
    for (let i = 0; i < tuning.chips.REFRESH_AT; i++) {
      s.toggleSelect(i);
      s.takeNext(); // the queue empties, so the series rule resets by itself
    }
    s.refresh();
    expect(s.hand[4]).toBe(keep);
  });

  it('reshuffles spent chips back instead of leaving the queue empty', () => {
    // The whole folder fits in one hand, so nothing is left in the draw pile.
    const s = sys(FIVE);
    for (let i = 0; i < tuning.chips.REFRESH_AT; i++) {
      s.toggleSelect(i);
      s.takeNext(); // the queue empties, so the series rule resets by itself
    }
    s.refresh();
    expect(s.usedSinceRefresh).toBe(0);
    expect(s.reshuffles).toBe(1);
    expect(s.hand.every((c) => c !== null)).toBe(true);
    expect(s.count('used')).toBe(0);
  });
});

describe('reshuffle', () => {
  it('reshuffles spent chips into the draw pile when it runs dry', () => {
    const folder = Array.from({ length: 6 }, () => ({ defId: 'cannon' as const, code: 'A' as const }));
    const cs = new ChipSystem(folder, new Rng(1));
    cs.dealHand(); // 5 in hand, 1 in the pile
    for (let i = 0; i < 3; i++) {
      cs.toggleSelect(i);
      cs.takeNext();
    }
    cs.refresh(); // draws the last pile chip, then the 3 spent ones come back
    expect(cs.hand.every((c) => c !== null)).toBe(true);
    expect(cs.reshuffles).toBe(1);
    expect(cs.count('used')).toBe(0);
  });

  it('gives a re-dealt chip a new deal serial', () => {
    // One chip: firing it and refreshing reshuffles it straight back into slot 0.
    const cs = new ChipSystem([chip('cannon', 'A')], new Rng(1));
    cs.dealHand();
    const first = cs.hand[0];
    expect(first).not.toBeNull();
    const deal = first?.deal ?? 0;
    expect(deal).toBeGreaterThan(0);
    cs.toggleSelect(0);
    cs.takeNext();
    cs.refresh();
    expect(cs.reshuffles).toBe(1);
    expect(cs.hand[0]?.uid).toBe(first?.uid);
    expect(cs.hand[0]?.deal).toBeGreaterThan(deal);
  });

  it('keeps empty slots when nothing was spent yet', () => {
    const folder = Array.from({ length: 3 }, () => ({ defId: 'cannon' as const, code: 'A' as const }));
    const cs = new ChipSystem(folder, new Rng(1));
    cs.dealHand();
    expect(cs.hand.filter((c) => c === null)).toHaveLength(2);
    expect(cs.reshuffles).toBe(0);
  });
});
