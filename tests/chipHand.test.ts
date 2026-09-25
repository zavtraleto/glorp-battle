import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import { Rng } from '../src/core/rng';
import { type ChipId } from '../src/data/chips';
import { ChipSystem, type FolderChip } from '../src/sim/chips/chipSystem';

// Real-time hand, Attack Queue and per-slot refills (GDD §5, §7). No Custom Screen: the
// player builds a series while the battle runs.

beforeEach(() => {
  mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING)));
});

const chip = (defId: ChipId): FolderChip => ({ defId });

function sys(list: FolderChip[], seed = 5): ChipSystem {
  const s = new ChipSystem(list, new Rng(seed));
  s.dealHand();
  return s;
}

const T = (seconds: number) => secondsToTicks(seconds);

/** Hand slot holding the first chip that matches, or -1. */
function slotOf(s: ChipSystem, defId: ChipId): number {
  return s.hand.findIndex((c) => c !== null && c.defId === defId);
}

const FIVE: FolderChip[] = [
  chip('cannon'),
  chip('cannon'),
  chip('guard'),
  chip('sword'),
  chip('airshot'),
];

const TEN: FolderChip[] = [...FIVE, ...FIVE.map((c) => ({ ...c }))];

describe('hand', () => {
  it('deals exactly hand.SIZE chips at the start of the battle', () => {
    const s = sys(TEN);
    expect(s.hand).toHaveLength(tuning.hand.SIZE);
    expect(s.hand.every((c) => c !== null)).toBe(true);
    expect(s.drawRemaining).toBe(TEN.length - tuning.hand.SIZE);
  });

  it('leaves slots empty when the folder runs short', () => {
    const s = sys([chip('cannon'), chip('sword')]);
    expect(s.hand.filter((c) => c !== null)).toHaveLength(2);
    expect(s.slotState(4)).toBe('empty');
  });
});

describe('attack queue', () => {
  it('adds a tapped chip at the end and numbers it', () => {
    const s = sys(FIVE);
    const a = slotOf(s, 'cannon');
    const b = slotOf(s, 'airshot');
    expect(s.toggleSelect(a)).toBe(true);
    expect(s.toggleSelect(b)).toBe(true);
    expect(s.attack).toEqual([a, b]);
    expect(s.queuePosition(a)).toBe(1);
    expect(s.queuePosition(b)).toBe(2);
    expect(s.slotState(a)).toBe('queued');
  });

  it('takes a chip back out before the first shot', () => {
    const s = sys(FIVE);
    const a = slotOf(s, 'cannon');
    s.toggleSelect(a);
    expect(s.toggleSelect(a)).toBe(true);
    expect(s.attack).toEqual([]);
    expect(s.slotState(a)).toBe('ready');
  });

  it('locks the series once the first chip has been fired', () => {
    const s = sys(FIVE);
    const a = slotOf(s, 'cannon');
    const b = slotOf(s, 'airshot');
    s.toggleSelect(a);
    s.toggleSelect(b);
    s.commitAttack();
    s.takeNext(0);
    expect(s.locked).toBe(true);
    expect(s.toggleSelect(b)).toBe(false);
    expect(s.attack).toEqual([b]);
  });

  it('can hold the whole hand', () => {
    const s = sys([chip('cannon'), chip('airshot'), chip('spreader'), chip('mine'), chip('guard')]);
    for (let i = 0; i < 5; i++) s.toggleSelect(i);
    expect(s.attack).toHaveLength(tuning.hand.SIZE);
    for (let i = 0; i < 5; i++) expect(s.slotState(i)).toBe('queued');
  });

});

describe('combination rule', () => {
  // Letter codes were removed (GDD §7.3, 2026-09-25): any chips combine for now.
  it('keeps every other chip ready once the first one is picked', () => {
    const s = sys(FIVE);
    s.toggleSelect(slotOf(s, 'cannon'));
    for (const id of ['guard', 'sword', 'airshot'] as const) expect(s.slotState(slotOf(s, id))).toBe('ready');
    expect(s.toggleSelect(slotOf(s, 'sword'))).toBe(true);
  });
});

describe('slot cooldown (GDD §5)', () => {
  const CD = () => T(tuning.hand.REFILL_COOLDOWN);

  /** Fires one single-chip charge from `slot` at `tick` and resolves it. */
  function fire(s: ChipSystem, slot: number, tick: number): void {
    s.toggleSelect(slot);
    s.commitAttack();
    s.takeNext(tick);
    s.reserveRefill(slot, tick);
    s.finishAttack();
  }

  it('keeps every other chip ready right after a single shot', () => {
    const s = sys(TEN);
    fire(s, 0, 0);
    expect(s.phase).toBe('selecting');
    expect(s.slotState(0)).toBe('cooling');
    for (let i = 1; i < 5; i++) expect(s.slotState(i)).toBe('ready');
  });

  it('keeps the rest of the hand locked while a charge is committed', () => {
    const s = sys(Array.from({ length: 6 }, () => chip('cannon')));
    s.toggleSelect(0);
    s.toggleSelect(1);
    s.commitAttack();
    s.takeNext(0);
    expect(s.slotState(1)).toBe('committed');
    expect(s.slotState(2)).toBe('locked');
  });

  it('reserves the next draw at resolution and brings it in after REFILL_COOLDOWN', () => {
    const s = sys(TEN);
    s.toggleSelect(0);
    s.commitAttack();
    s.takeNext(0);
    const next = s.reserveRefill(0, 0);
    s.finishAttack();

    expect(next).not.toBeNull();
    expect(s.pendingChip(0)).toBe(next);
    expect(s.hand).not.toContain(next);
    expect(s.refillProgress(0, 0)).toBe(0);
    expect(s.refillProgress(0, T(1))).toBeCloseTo(T(1) / CD(), 5);
    expect(s.refillReady(CD() - 1)).toBe(0);
    expect(s.hand[0]).toBeNull();
    expect(s.refillReady(CD())).toBe(1);
    expect(s.hand[0]).toBe(next);
    expect(s.slotState(0)).toBe('ready');
    expect(s.pendingChip(0)).toBeNull();
  });

  it('runs every slot on its own timer', () => {
    const s = sys(TEN);
    fire(s, 0, 0);
    fire(s, 1, T(1));
    expect(s.refillReady(CD())).toBe(1);
    expect(s.slotState(0)).toBe('ready');
    expect(s.slotState(1)).toBe('cooling');
    expect(s.refillReady(CD() + T(1))).toBe(1);
    expect(s.slotState(1)).toBe('ready');
  });

  it('keeps a chip that arrives during a committed charge locked until the charge ends', () => {
    const s = sys(Array.from({ length: 7 }, () => chip('cannon')));
    s.toggleSelect(0);
    s.toggleSelect(1);
    s.commitAttack();
    s.takeNext(0);
    s.reserveRefill(0, 0);

    expect(s.refillReady(CD())).toBe(1);
    expect(s.slotState(0)).toBe('locked');

    s.takeNext(CD());
    s.reserveRefill(1, CD());
    s.finishAttack();
    expect(s.slotState(0)).toBe('ready');
    expect(s.slotState(1)).toBe('cooling');
  });

  it('cuts the cooldown of the named slots and never below its start', () => {
    const s = sys(TEN);
    fire(s, 0, 0);
    fire(s, 1, 0);
    expect(s.cutCooldowns([0], T(1))).toEqual([0]);
    expect(s.refillProgress(0, T(1))).toBeCloseTo(T(1) / (CD() - T(1)), 5);
    expect(s.refillReady(CD() - T(1))).toBe(1);
    expect(s.slotState(0)).toBe('ready');
    expect(s.slotState(1)).toBe('cooling');

    expect(s.cutCooldowns([1], CD() * 10)).toEqual([1]);
    expect(s.refillProgress(1, 0)).toBe(1);
    expect(s.refillReady(0)).toBe(1);
  });

  it('skips slots with nothing cooling', () => {
    const s = sys(TEN);
    expect(s.cutCooldowns([0, 1], T(1))).toEqual([]);
  });

  it('burns the committed tail; burned slots start cooling on the next refill pass', () => {
    const s = sys(Array.from({ length: 7 }, () => chip('cannon')));
    s.toggleSelect(0);
    s.toggleSelect(1);
    s.commitAttack();

    expect(s.burnAttackTail()).toEqual([0, 1]);
    expect(s.attack).toEqual([]);
    expect(s.hand[0]).toBeNull();
    expect(s.count('used')).toBe(2);
    s.finishAttack();

    expect(s.refillReady(T(1))).toBe(0);
    expect(s.slotState(0)).toBe('cooling');
    expect(s.slotState(1)).toBe('cooling');
    expect(s.refillReady(T(1) + CD())).toBe(2);
  });

  it('does not refill the slot of a chip that may still come back', () => {
    const s = sys(TEN);
    s.toggleSelect(0);
    s.commitAttack();
    const active = s.takeNext(0)!;
    s.refillReady(CD(), { slot: 0, uid: active.uid });
    expect(s.pendingChip(0)).toBeNull();
    expect(s.restoreInterrupted(active, 0)).toBe(true);
  });

  it('refills only spent slots and preserves intentionally empty hand slots', () => {
    const s = new ChipSystem(FIVE, new Rng(1));
    s.dealHandExact([chip('cannon'), null, null, null, null]);
    fire(s, 0, 0);
    expect(s.refillReady(CD())).toBe(1);
    expect(s.hand[0]).not.toBeNull();
    expect(s.hand.slice(1)).toEqual([null, null, null, null]);
  });

  it('leaves untouched chips where they are', () => {
    const s = sys(TEN);
    const keep = s.hand[4];
    fire(s, 0, 0);
    s.refillReady(CD());
    expect(s.hand[4]).toBe(keep);
  });
});

describe('reshuffle', () => {
  it('reshuffles spent chips when a slot exhausts the draw pile', () => {
    // The whole folder fits in one hand, so nothing is left in the draw pile.
    const s = sys(FIVE);
    s.toggleSelect(0);
    s.commitAttack();
    s.takeNext(0);
    s.reserveRefill(0, 0);
    expect(s.reshuffles).toBe(1);
    s.finishAttack();
    s.refillReady(T(tuning.hand.REFILL_COOLDOWN));
    expect(s.hand.every((c) => c !== null)).toBe(true);
    expect(s.count('used')).toBe(0);
  });

  it('reshuffles spent chips into the draw pile when it runs dry', () => {
    const folder = Array.from({ length: 6 }, () => chip('cannon'));
    const cs = new ChipSystem(folder, new Rng(1));
    cs.dealHand(); // 5 in hand, 1 in the pile
    for (let i = 0; i < 3; i++) cs.toggleSelect(i);
    cs.commitAttack();
    for (let i = 0; i < 3; i++) cs.takeNext(0);
    cs.finishAttack();
    cs.refillReady(0); // reserves the last pile chip, then the spent ones come back
    cs.refillReady(T(tuning.hand.REFILL_COOLDOWN));
    expect(cs.hand.every((c) => c !== null)).toBe(true);
    expect(cs.reshuffles).toBe(1);
    expect(cs.count('used')).toBe(0);
  });

  it('gives a re-dealt chip a new deal serial', () => {
    // One chip: firing it and refilling reshuffles it straight back into slot 0.
    const cs = new ChipSystem([chip('cannon')], new Rng(1));
    cs.dealHand();
    const first = cs.hand[0];
    expect(first).not.toBeNull();
    const deal = first?.deal ?? 0;
    expect(deal).toBeGreaterThan(0);
    cs.toggleSelect(0);
    cs.commitAttack();
    cs.takeNext(0);
    cs.reserveRefill(0, 0);
    cs.finishAttack();
    cs.refillReady(T(tuning.hand.REFILL_COOLDOWN));
    expect(cs.reshuffles).toBe(1);
    expect(cs.hand[0]?.uid).toBe(first?.uid);
    expect(cs.hand[0]?.deal).toBeGreaterThan(deal);
  });

  it('keeps empty slots when nothing was spent yet', () => {
    const folder = Array.from({ length: 3 }, () => chip('cannon'));
    const cs = new ChipSystem(folder, new Rng(1));
    cs.dealHand();
    expect(cs.hand.filter((c) => c === null)).toHaveLength(2);
    expect(cs.reshuffles).toBe(0);
  });
});
