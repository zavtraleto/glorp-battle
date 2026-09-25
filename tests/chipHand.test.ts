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
    s.startAttack();
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

  it('exposes the committed tail separately from the locked hand', () => {
    const s = sys(Array.from({ length: 6 }, () => chip('cannon')));
    s.toggleSelect(0);
    s.toggleSelect(1);
    s.startAttack();
    s.takeNext(0);

    expect(s.slotState(1)).toBe('committed');
    expect(s.slotState(2)).toBe('locked');
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

describe('shared hand cooldown', () => {
  it('can commit a combo without starting cooldown until the combo finishes', () => {
    const s = sys(Array.from({ length: 7 }, () => chip('cannon')));
    s.toggleSelect(0);
    s.toggleSelect(1);

    expect(s.commitAttack()).toBe(true);
    expect(s.phase).toBe('committed');
    expect(s.handCooldownProgress(0)).toBeNull();

    s.takeNext(0);
    s.startCooldown(T(1));
    s.reserveSpentRefills();
    expect(s.handCooldownProgress(T(1))).toBe(0);
    expect(s.pendingChip(0)).not.toBeNull();
  });

  it('burns the committed tail into spent slots without returning it to the hand', () => {
    const s = sys(Array.from({ length: 7 }, () => chip('cannon')));
    s.toggleSelect(0);
    s.toggleSelect(1);
    s.commitAttack();

    expect(s.burnAttackTail()).toEqual([0, 1]);
    expect(s.attack).toEqual([]);
    expect(s.hand[0]).toBeNull();
    expect(s.hand[1]).toBeNull();
    expect(s.count('used')).toBe(2);
  });

  it('refills only spent slots and preserves intentionally empty hand slots', () => {
    const s = new ChipSystem(FIVE, new Rng(1));
    s.dealHandExact([chip('cannon'), null, null, null, null]);
    s.toggleSelect(0);
    s.startAttack();
    s.takeNext(0);
    s.finishAttack();

    expect(s.refillReady(T(4))).toBe(1);
    expect(s.hand[0]).not.toBeNull();
    expect(s.hand.slice(1)).toEqual([null, null, null, null]);
  });

  it('keeps a ready refill sunk until the committed charge is finished', () => {
    const s = sys(Array.from({ length: 7 }, () => chip('cannon')));
    s.toggleSelect(0);
    s.toggleSelect(1);
    s.startAttack();
    s.takeNext(0);
    s.reserveRefill(0);

    expect(s.refillReady(T(4))).toBe(0);
    expect(s.hand[0]).toBeNull();

    s.takeNext(T(4));
    s.reserveRefill(1);
    s.finishAttack();
    expect(s.refillReady(T(4))).toBe(2);
  });

  it('reserves a replacement at resolution and reports shared progress', () => {
    const s = sys(TEN);
    s.toggleSelect(0);
    s.startAttack();
    s.takeNext(0);

    const next = s.reserveRefill(0);
    expect(next).not.toBeNull();
    expect(s.pendingChip(0)).toBe(next);
    expect(s.hand[0]).toBeNull();
    expect(s.slotState(0)).toBe('cooling');
    expect(s.hand).not.toContain(next);
    expect(s.refillProgress(0, 0)).toBe(0);
    expect(s.refillProgress(0, T(1))).toBeCloseTo(0.25, 5);
    s.finishAttack();
    expect(s.refillReady(T(4) - 1)).toBe(0);
    expect(s.hand[0]).toBeNull();
    expect(s.refillReady(T(4))).toBe(1);
    expect(s.hand[0]).toBe(next);
    expect(s.pendingChip(0)).toBeNull();
  });

  it('reports the shared hand cooldown for untouched chips too', () => {
    const s = sys(TEN);
    const progress = (s as unknown as { handCooldownProgress?: (tick: number) => number | null }).handCooldownProgress;
    expect(progress).toBeTypeOf('function');
    if (!progress) return;

    s.toggleSelect(0);
    s.startAttack();
    s.takeNext(0);
    s.reserveRefill(0);
    s.finishAttack();

    expect(progress.call(s, T(2))).toBeCloseTo(0.5, 5);
    expect(s.slotState(1)).toBe('locked');
    expect(s.hand[1]).not.toBeNull();
  });

  it('refills every spent slot together from the first shot timestamp', () => {
    const s = sys(Array.from({ length: 7 }, () => chip('cannon')));
    s.toggleSelect(0);
    s.toggleSelect(1);
    s.startAttack();
    s.takeNext(0);
    s.reserveRefill(0);
    s.takeNext(T(3));
    s.reserveRefill(1);
    s.finishAttack();
    expect(s.refillReady(T(4) - 1)).toBe(0);
    expect(s.hand[0]).toBeNull();
    expect(s.hand[1]).toBeNull();
    expect(s.refillReady(T(4))).toBe(2);
    expect(s.hand[0]).not.toBeNull();
    expect(s.hand[1]).not.toBeNull();
  });

  it('leaves untouched chips where they are', () => {
    const s = sys(TEN);
    const keep = s.hand[4];
    s.toggleSelect(0);
    s.startAttack();
    s.takeNext(0);
    s.finishAttack();
    s.refillReady(T(4));
    expect(s.hand[4]).toBe(keep);
  });

  it('reshuffles spent chips when a ready slot exhausts the draw pile', () => {
    // The whole folder fits in one hand, so nothing is left in the draw pile.
    const s = sys(FIVE);
    s.toggleSelect(0);
    s.startAttack();
    s.takeNext(0);
    s.finishAttack();
    s.refillReady(T(4));
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
    for (let i = 0; i < 3; i++) cs.toggleSelect(i);
    cs.startAttack();
    for (let i = 0; i < 3; i++) cs.takeNext(0);
    cs.finishAttack();
    cs.refillReady(T(4)); // draws the last pile chip, then the 3 spent ones come back
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
    cs.startAttack();
    cs.takeNext(0);
    cs.finishAttack();
    cs.refillReady(T(4));
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
