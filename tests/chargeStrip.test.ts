import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, tuning } from '../src/config/tuning';
import { CHIPS, type ChipId } from '../src/data/chips';
import { World } from '../src/sim/world';
import {
  ChargeTracker,
  chargeStrip,
  chipMask,
  maskFromRows,
  type ChargeStripInput,
  type StripItem,
} from '../src/terminal/crt/chargeStrip';
import { EMPTY_HUD, hudKey } from '../src/terminal/crt/hudModel';

// The charge strip under the field (GDD §7.2, decision 2026-09-28).
const DT = 1 / 60;
let uid = 70_000;

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

const input = (over: Partial<ChargeStripInput> = {}): ChargeStripInput => ({
  spent: [],
  active: null,
  queued: [],
  selecting: true,
  combo: false,
  burned: [],
  ...over,
});

/** The strip as short tokens: `cannon`, `*cannon` (active), `-cannon` (spent), `!cannon` (burned), `?`, `ok`. */
function tokens(items: readonly StripItem[]): string[] {
  const mark = { queued: '', active: '*', spent: '-', burned: '!' } as const;
  return items.map((i) => (i.kind === 'chip' ? `${mark[i.tone]}${i.id}` : i.kind === 'ask' ? '?' : 'ok'));
}

describe('charge strip model', () => {
  it('asks for a chip while the charge is empty or short', () => {
    expect(tokens(chargeStrip(input(), 3))).toEqual(['?']);
    expect(tokens(chargeStrip(input({ queued: ['cannon'] }), 3))).toEqual(['cannon', '?']);
    expect(tokens(chargeStrip(input({ queued: ['cannon', 'sword'] }), 3))).toEqual(['cannon', 'sword', '?']);
  });

  it('stops asking at the hint limit, but still shows longer charges', () => {
    expect(tokens(chargeStrip(input({ queued: ['cannon', 'sword', 'mine'] }), 3))).toEqual(['cannon', 'sword', 'mine']);
    const four: ChipId[] = ['cannon', 'sword', 'mine', 'block'];
    expect(tokens(chargeStrip(input({ queued: four }), 3))).toEqual(four);
  });

  it('ticks a running combo and lights the active chip', () => {
    const s = chargeStrip(input({ selecting: false, combo: true, spent: ['cannon'], active: 'sword', queued: ['mine'] }), 3);
    expect(tokens(s)).toEqual(['-cannon', '*sword', 'mine', 'ok']);
  });

  it('shows a lone chip in use without the combo tick', () => {
    expect(tokens(chargeStrip(input({ selecting: false, active: 'cannon' }), 3))).toEqual(['*cannon']);
  });

  it('shows only the burned tail while it flashes', () => {
    const s = chargeStrip(input({ selecting: false, spent: ['cannon'], burned: ['sword', 'mine'] }), 3);
    expect(tokens(s)).toEqual(['-cannon', '!sword', '!mine']);
  });

  it('redraws when the strip changes, and blinks only while it asks or burns', () => {
    const ask = { ...EMPTY_HUD, strip: chargeStrip(input(), 3) };
    const one = { ...EMPTY_HUD, strip: chargeStrip(input({ queued: ['cannon', 'sword', 'mine'] }), 3) };
    expect(hudKey(ask, true)).not.toBe(hudKey(one, true));
    expect(hudKey(ask, true)).not.toBe(hudKey(ask, false));
    expect(hudKey(one, true)).toBe(hudKey(one, false));
  });
});

describe('chip icon masks', () => {
  it('drops the outline and splits colours into two levels', () => {
    const m = maskFromRows(['kw', 'd.']);
    expect(m.w).toBe(2);
    expect([...m.levels]).toEqual([0, 2, 1, 0]);
  });

  it('has a visible monochrome icon for every chip', () => {
    for (const id of Object.keys(CHIPS) as ChipId[]) {
      const m = chipMask(id);
      expect(m.w * m.h, id).toBe(m.levels.length);
      expect(m.levels.some((l) => l > 0), id).toBe(true);
      expect(m.levels.every((l) => l <= 2), id).toBe(true);
    }
  });
});

describe('charge tracker with the sim', () => {
  function world(): World {
    const w = new World({ seed: 17, battleIndex: 1, skipIntro: true, cheats: { god: false, aiEnabled: false } });
    for (const enemy of w.enemies) enemy.hp = 10_000;
    return w;
  }

  function frame(w: World, tracker: ChargeTracker, use = false): string[] {
    w.step(DT, { commands: use ? [{ type: 'useChip' }] : [], held: null });
    for (const e of w.drainEvents()) {
      if (e.type === 'chipUsed') tracker.chipUsed(e.defId);
      if (e.type === 'chipInterrupted') tracker.chipInterrupted(e.defId);
      if (e.type === 'comboBroken') tracker.comboBroken(tuning.terminal.STRIP_BURN_TIME);
    }
    const s = tracker.update(DT, {
      active: w.activeChip?.def.id ?? null,
      queued: w.chips.attackChips().map((c) => c.defId),
      selecting: w.chips.phase === 'selecting',
      combo: w.combo !== null,
    });
    return tokens(chargeStrip(s, tuning.hand.QUEUE_CELLS));
  }

  it('follows a two-chip combo from selection to the end', () => {
    const w = world();
    const tracker = new ChargeTracker();
    for (const defId of ['cannon', 'sword'] as ChipId[]) w.giveChip({ uid: uid++, defId, state: 'queued', deal: 0 });
    expect(frame(w, tracker)).toEqual(['cannon', 'sword', '?']);
    expect(frame(w, tracker, true)).toEqual(['*cannon', 'sword', 'ok']);
    // Wait out the first chip, then fire the second.
    for (let i = 0; i < 120 && w.activeChip; i++) frame(w, tracker);
    expect(frame(w, tracker, true)).toEqual(['-cannon', '*sword', 'ok']);
    for (let i = 0; i < 120 && w.activeChip; i++) frame(w, tracker);
    expect(frame(w, tracker)).toEqual(['?']);
  });

  it('flashes the burned tail after a Combo Break, then asks again', () => {
    const w = world();
    const tracker = new ChargeTracker();
    for (const defId of ['cannon', 'sword', 'mine'] as ChipId[]) w.giveChip({ uid: uid++, defId, state: 'queued', deal: 0 });
    frame(w, tracker, true);
    for (let i = 0; i < 120 && w.activeChip; i++) frame(w, tracker);
    expect(w.combo).not.toBeNull();
    // A real HP loss breaks the combo (GDD §6.6).
    tracker.comboBroken(tuning.terminal.STRIP_BURN_TIME);
    const s = tracker.update(DT, { active: null, queued: [], selecting: true, combo: false });
    expect(tokens(chargeStrip(s, 3))).toEqual(['-cannon', '!sword', '!mine']);
    const after = tracker.update(tuning.terminal.STRIP_BURN_TIME, { active: null, queued: [], selecting: true, combo: false });
    expect(tokens(chargeStrip(after, 3))).toEqual(['?']);
  });
});
