import { beforeEach, describe, expect, it } from 'vitest';
import { TutorialDirector } from '../src/app/tutorial/director';
import { DEFAULT_TUNING, mergeTuning, tuning } from '../src/config/tuning';
import { TUTORIAL } from '../src/data/tutorial';
import type { SimEvent } from '../src/sim/events';
import type { World } from '../src/sim/world';

const DT = 1 / 60;
const CHEATS = { god: false, aiEnabled: false, noKo: true };

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

function idle(d: TutorialDirector, w: World, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) d.update(w, [], DT);
}

describe('TutorialDirector', () => {
  it('starts on the first beat with an empty hand', () => {
    const d = new TutorialDirector();
    const w = d.newWorld(CHEATS);
    expect(d.stepIndex).toBe(0);
    expect(d.beatId).toBe('swipe');
    expect(w.chips.hand.every((c) => c === null)).toBe(true);
  });

  it('raises the hint level at 2, 4 and 8 seconds of inaction', () => {
    const d = new TutorialDirector();
    const w = d.newWorld(CHEATS);
    expect(d.hint().level).toBe(0);
    idle(d, w, tuning.tutorial.TUT_HINT_PULSE + DT);
    expect(d.hint().level).toBe(1);
    expect(d.hint().focus).toBe('move');
    idle(d, w, tuning.tutorial.TUT_HINT_SEG - tuning.tutorial.TUT_HINT_PULSE);
    expect(d.hint().level).toBe(2);
    expect(d.hint().seg).toBe('SWIPE BALL');
    idle(d, w, tuning.tutorial.TUT_HINT_LINE - tuning.tutorial.TUT_HINT_SEG);
    expect(d.hint().level).toBe(3);
    expect(d.hint().line).toBe('SWIPE THE BALL TO STEP');
  });

  it('gives no hint at all on a beat with no seg or line (the exam battle)', () => {
    const d = new TutorialDirector();
    for (let i = 0; i < 3; i++) d.advanceStep();
    const w = d.newWorld(CHEATS);
    expect(d.beatId).toBe('exam');
    idle(d, w, tuning.tutorial.TUT_HINT_LINE + DT);
    const hint = d.hint();
    expect(hint.level).toBe(0);
    expect(hint.focus).toBeNull();
    expect(hint.seg).toBeNull();
    expect(hint.line).toBeNull();
  });

  it('resets the hint timer when the player acts', () => {
    const d = new TutorialDirector();
    const w = d.newWorld(CHEATS);
    idle(d, w, tuning.tutorial.TUT_HINT_SEG + DT);
    expect(d.hint().level).toBe(2);
    w.player.x = w.player.x === 0 ? 1 : 0;
    d.update(w, [], DT);
    expect(d.hint().level).toBe(0);
  });

  it('passes beat 1 only after three steps and one enemy attack', () => {
    const d = new TutorialDirector();
    const w = d.newWorld(CHEATS);
    const attack: SimEvent = { type: 'attackSpawned', id: 1, kind: 'shockwave', x: 1, y: 2 };
    for (let i = 0; i < 3; i++) {
      w.player.x = (w.player.x + 1) % 3;
      d.update(w, [], DT);
    }
    expect(d.beatId).toBe('swipe');
    d.update(w, [attack], DT);
    expect(d.beatId).toBe('load');
  });

  it('deals the cannon into the middle slot when beat 2 begins', () => {
    const d = new TutorialDirector();
    const w = d.newWorld(CHEATS);
    const attack: SimEvent = { type: 'attackSpawned', id: 1, kind: 'shockwave', x: 1, y: 2 };
    for (let i = 0; i < 3; i++) {
      w.player.x = (w.player.x + 1) % 3;
      d.update(w, [], DT);
    }
    d.update(w, [attack], DT);
    expect(w.chips.hand[2]?.defId).toBe('cannon');
    expect(w.chips.slotState(2)).toBe('ready');
  });

  it('does not pass a beat on inaction alone', () => {
    const d = new TutorialDirector();
    const w = d.newWorld(CHEATS);
    idle(d, w, 20);
    expect(d.beatId).toBe('swipe');
    expect(w.chips.hand[2]).toBeNull();
  });

  it('is not done until the last step is finished', () => {
    const d = new TutorialDirector();
    expect(d.done).toBe(false);
    for (let i = 0; i < 4; i++) d.advanceStep();
    expect(d.done).toBe(true);
  });

  // Regression: a step's first beat has no `enter` hook today, but if a future
  // one moved the player or queued a chip, that side effect must not be read
  // back as a player action on the same tick (the bug already fixed for the
  // beat-transition path in this file's other tests).
  it("does not credit a beat's own enter hook with the player's first step", () => {
    const beat = TUTORIAL[0]?.beats[0];
    if (!beat) throw new Error('tutorial step 1 has no first beat');
    const originalEnter = beat.enter;
    beat.enter = (w) => {
      w.player.x = (w.player.x + 1) % 3;
      w.chips.attack.push(0);
    };
    try {
      const d = new TutorialDirector();
      const w = d.newWorld(CHEATS);
      // First update runs the stubbed `enter`, which moves the player and
      // queues a chip by itself — this must not count as the player acting.
      d.update(w, [], DT);
      expect(d.beatId).toBe('swipe');
      // Two real player steps plus one enemy attack: three steps in total
      // only if the hook's own move was (wrongly) counted as the first one.
      for (let i = 0; i < 2; i++) {
        w.player.x = (w.player.x + 1) % 3;
        d.update(w, [], DT);
      }
      const attack: SimEvent = { type: 'attackSpawned', id: 1, kind: 'shockwave', x: 1, y: 2 };
      d.update(w, [attack], DT);
      expect(d.beatId).toBe('swipe');
    } finally {
      beat.enter = originalEnter;
    }
  });
});
