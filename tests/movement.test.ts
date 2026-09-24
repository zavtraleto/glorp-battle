import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import { InputState, type Command, type Dir } from '../src/core/input/commands';
import { FixedStepClock } from '../src/core/loop';
import { SwipeRecognizer } from '../src/core/input/swipe';
import { Occupancy } from '../src/sim/occupancy';
import { World } from '../src/sim/world';

const DT = 1 / 60;

function freshWorld(): World {
  return new World({ seed: 1, battleIndex: 1, cheats: { god: false, aiEnabled: false }, skipIntro: true });
}

/** Runs one tick with the given presses. */
function tick(w: World, presses: Dir[] = [], held: Dir | null = null): void {
  const commands: Command[] = presses.map((dir) => ({ type: 'move', dir }));
  w.step(DT, { commands, held });
}

function idle(w: World, ticks: number, held: Dir | null = null): void {
  for (let i = 0; i < ticks; i++) tick(w, [], held);
}

const pos = (w: World) => [w.player.x, w.player.y];
const cooldown = () => secondsToTicks(tuning.player.CELL_MOVE_TIME);

beforeEach(() => {
  mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING)));
});

describe('player movement', () => {
  it('starts at (1,4) with full HP', () => {
    const w = freshWorld();
    expect(pos(w)).toEqual([1, 4]);
    expect(w.player.hp).toBe(w.player.maxHp);
  });

  it('steps one cell in four directions', () => {
    const w = freshWorld();
    tick(w, ['up']);
    expect(pos(w)).toEqual([1, 3]);
    idle(w, cooldown());
    tick(w, ['left']);
    expect(pos(w)).toEqual([0, 3]);
    idle(w, cooldown());
    tick(w, ['down']);
    expect(pos(w)).toEqual([0, 4]);
    idle(w, cooldown());
    tick(w, ['right']);
    expect(pos(w)).toEqual([1, 4]);
  });

  it('never leaves the 3×3 player territory', () => {
    const w = freshWorld();
    const dirs: Dir[] = ['up', 'up', 'up', 'left', 'left', 'left', 'down', 'down', 'down', 'down', 'right', 'right', 'right', 'right'];
    for (const d of dirs) {
      tick(w, [d]);
      idle(w, cooldown());
      expect(w.player.x).toBeGreaterThanOrEqual(0);
      expect(w.player.x).toBeLessThanOrEqual(2);
      expect(w.player.y).toBeGreaterThanOrEqual(3);
      expect(w.player.y).toBeLessThanOrEqual(5);
    }
    expect(pos(w)).toEqual([2, 5]);
  });

  it('cannot enter the enemy territory from the front row', () => {
    const w = freshWorld();
    tick(w, ['up']);
    idle(w, cooldown());
    tick(w, ['up']);
    expect(pos(w)).toEqual([1, 3]);
  });

  it('updates occupancy with the player position', () => {
    const w = freshWorld();
    tick(w, ['left']);
    expect(w.occupancy.get(0, 4)).toBe(w.player.id);
    expect(w.occupancy.isFree(1, 4)).toBe(true);
  });

  it('respects the cooldown and buffers only the latest press', () => {
    const w = freshWorld();
    tick(w, ['up']);
    tick(w, ['left']);
    tick(w, ['right']); // replaces 'left' in the buffer
    expect(pos(w)).toEqual([1, 3]);
    idle(w, cooldown());
    expect(pos(w)).toEqual([2, 3]);
    expect(w.player.moves).toBe(2);
    idle(w, cooldown() * 2);
    expect(w.player.moves).toBe(2);
  });

  it('uses the configured 200 ms cell move cadence', () => {
    const w = freshWorld();
    tick(w, ['left']);
    idle(w, cooldown() - 1);
    expect(pos(w)).toEqual([0, 4]);
    idle(w, 1);
    tick(w, ['right']);
    expect(pos(w)).toEqual([1, 4]);
  });

  it('repeats a held direction after the initial delay, then at the repeat interval', () => {
    const w = freshWorld();
    const delay = secondsToTicks(tuning.input.HOLD_REPEAT_DELAY);
    const repeat = secondsToTicks(tuning.input.HOLD_REPEAT);
    tick(w, ['up']); // (1,3)
    idle(w, cooldown());
    tick(w, ['down'], 'down'); // discrete press → (1,4), restarts the delay
    expect(pos(w)).toEqual([1, 4]);
    idle(w, delay - 1, 'down');
    expect(pos(w)).toEqual([1, 4]);
    idle(w, 1, 'down');
    expect(pos(w)).toEqual([1, 5]);
    // Further repeats use the shorter interval.
    tick(w, [], 'left');
    idle(w, repeat - 1, 'left');
    expect(pos(w)).toEqual([0, 5]);
  });

  it('a key held shorter than the repeat delay steps only once', () => {
    const w = freshWorld();
    tick(w, ['right'], 'right');
    idle(w, secondsToTicks(0.3), 'right');
    tick(w, ['up'], 'up');
    expect(pos(w)).toEqual([2, 3]);
  });

  it('does not repeat without a held direction', () => {
    const w = freshWorld();
    tick(w, ['left']);
    idle(w, 120);
    expect(pos(w)).toEqual([0, 4]);
  });

  it('allows movement during a chip action animation', () => {
    const w = freshWorld();
    w.player.actionTicks = 10;
    tick(w, ['up']);
    idle(w, 20);
    expect(pos(w)).toEqual([1, 3]);
  });

  it('ignores input outside ACTION', () => {
    const w = freshWorld();
    w.state = 'PAUSED';
    tick(w, ['up'], 'up');
    idle(w, 60, 'up');
    expect(pos(w)).toEqual([1, 4]);
  });

  it('does not step into an occupied cell', () => {
    const w = freshWorld();
    w.occupancy.place(99, 1, 3);
    tick(w, ['up']);
    expect(pos(w)).toEqual([1, 4]);
  });
});

describe('Occupancy', () => {
  it('rejects double placement and out-of-field cells', () => {
    const o = new Occupancy();
    o.place(1, 0, 0);
    expect(() => o.place(2, 0, 0)).toThrow();
    expect(o.isFree(3, 0)).toBe(false);
    expect(o.isFree(0, 6)).toBe(false);
  });
});

const TIMING = { rearmTime: 0.08, restPx: 4, continueTime: 0.1, continuePx: 60 };

describe('SwipeRecognizer', () => {
  it('fires once the threshold is crossed, by dominant axis', () => {
    const s = new SwipeRecognizer(24, 0.35);
    s.begin(100, 100, 0);
    expect(s.move(110, 105)).toBeNull();
    expect(s.move(126, 110)).toBe('right');
  });

  it('gives one step for a long drag in one direction (one stroke = one panel)', () => {
    const s = new SwipeRecognizer(24, 0.35, TIMING);
    s.begin(0, 0, 0);
    const fired: (Dir | null)[] = [];
    // A 150 px flick in 16 ms events.
    for (let i = 1; i <= 10; i++) fired.push(s.move(i * 15, i % 2, i * 0.016));
    expect(fired.filter(Boolean)).toEqual(['right']);
  });

  it('starts a new stroke after the held finger rests for rearmTime', () => {
    const s = new SwipeRecognizer(24, 0.35, TIMING);
    s.begin(0, 0, 0);
    expect(s.move(30, 0, 0.02)).toBe('right');
    expect(s.move(32, 1, 0.06)).toBeNull(); // jitter inside restPx is still a rest
    expect(s.move(50, 0, 0.09)).toBeNull(); // 0.07 s since the finger stopped: too soon
    expect(s.move(52, 0, 0.2)).toBeNull();
    expect(s.move(80, 0, 0.22)).toBe('right'); // rested at x = 50, then a fresh 30 px
  });

  // Pointer events every 16 ms at `speed` px per event, from x = 0; returns the fired steps.
  function drag(s: SwipeRecognizer, speed: number, events: number): Dir[] {
    const fired: Dir[] = [];
    for (let i = 1; i <= events; i++) {
      const d = s.move(i * speed, 0, i * 0.016);
      if (d) fired.push(d);
    }
    return fired;
  }

  it('keeps a quick flick to one panel', () => {
    const s = new SwipeRecognizer(24, 0.35, TIMING);
    s.begin(0, 0, 0);
    // 150 px in 160 ms: the step fires at 30 px, only 15 px remain after continueTime.
    expect(drag(s, 15, 10)).toEqual(['right']);
  });

  it('gives a second dash when the stroke goes on continuePx after continueTime', () => {
    const s = new SwipeRecognizer(24, 0.35, TIMING);
    s.begin(0, 0, 0);
    // 10 px per event: step at 30 px (48 ms); the dash anchor is set at 160 ms (x = 100).
    expect(drag(s, 10, 15)).toEqual(['right']); // x = 150: 50 px into the dash
    expect(s.move(160, 0, 0.26)).toBe('right');
  });

  it('does not dash on a pull-back after continueTime', () => {
    const s = new SwipeRecognizer(24, 0.35, TIMING);
    s.begin(0, 0, 0);
    expect(drag(s, 10, 10)).toEqual(['right']);
    for (let i = 1; i <= 10; i++) expect(s.move(100 - i * 12, 0, 0.16 + i * 0.016)).toBeNull();
  });

  it('fires at once on a perpendicular turn (L-shaped drag)', () => {
    const s = new SwipeRecognizer(24, 0.35, TIMING);
    s.begin(0, 0, 0);
    expect(s.move(30, 0, 0.02)).toBe('right');
    expect(s.move(60, 0, 0.04)).toBeNull();
    expect(s.move(60, -30, 0.06)).toBe('up');
    expect(s.move(30, -30, 0.08)).toBe('left');
  });

  it('does not move again while the finger stays still or jitters inside the dead zone', () => {
    const s = new SwipeRecognizer(24, 0.35);
    s.begin(0, 0, 0);
    expect(s.move(30, 0, 0.02)).toBe('right');
    expect(s.move(30, 0, 0.2)).toBeNull();
    expect(s.move(33, -2, 0.3)).toBeNull();
    expect(s.move(27, 3, 0.4)).toBeNull();
  });

  it('ignores the thumb pulling back after a stroke; a reversal needs a rest', () => {
    const s = new SwipeRecognizer(24, 0.35, TIMING);
    s.begin(0, 0, 0);
    expect(s.move(30, 0, 0.01)).toBe('right');
    expect(s.move(10, 0, 0.02)).toBeNull();
    expect(s.move(-20, 0, 0.03)).toBeNull();
    expect(s.move(-50, 0, 0.2)).toBe('left');
  });

  it('counts a gesture with steps as a step, not a tap', () => {
    const s = new SwipeRecognizer(24, 0.35);
    s.begin(0, 0, 0);
    s.move(30, 0, 0.02);
    s.move(30, 0, 0.12);
    expect(s.end(0.2)).toBe('step');
  });

  it('starts a new gesture from a clean anchor after release', () => {
    const s = new SwipeRecognizer(24, 0.35);
    s.begin(0, 0, 0);
    expect(s.move(30, 0)).toBe('right');
    expect(s.end(0.1)).toBe('step');
    expect(s.move(60, 0)).toBeNull();
    s.begin(60, 0, 1);
    expect(s.move(60, -30)).toBe('up');
  });

  it('detects all four directions in screen space', () => {
    const cases: [number, number, Dir][] = [
      [0, -30, 'up'],
      [0, 30, 'down'],
      [-30, 0, 'left'],
      [30, 0, 'right'],
    ];
    for (const [dx, dy, dir] of cases) {
      const s = new SwipeRecognizer(24, 0.35);
      s.begin(50, 50, 0);
      expect(s.move(50 + dx, 50 + dy)).toBe(dir);
    }
  });

  it('ignores movement when no gesture is active', () => {
    const s = new SwipeRecognizer(24, 0.35);
    expect(s.move(100, 100)).toBeNull();
    s.begin(0, 0, 0);
    s.end(0.1);
    expect(s.move(100, 0)).toBeNull();
  });

  // The trackball is the only battle control: a gesture that never travelled
  // is the chip shot (spec §10.2).
  it('reports a tap when the gesture ends without a step', () => {
    const s = new SwipeRecognizer(24, 0.35);
    s.begin(50, 50, 1.0);
    expect(s.move(52, 51)).toBeNull();
    expect(s.end(1.1)).toBe('tap');
  });

  it('reports a step, not a tap, once the threshold was crossed', () => {
    const s = new SwipeRecognizer(24, 0.35);
    s.begin(50, 50, 1.0);
    expect(s.move(90, 50)).toBe('right');
    expect(s.end(1.1)).toBe('step');
  });

  it('reports nothing when the finger rested past the tap window', () => {
    const s = new SwipeRecognizer(24, 0.35);
    s.begin(50, 50, 1.0);
    expect(s.end(1.4)).toBe('none');
  });

  it('reports nothing when no gesture was active', () => {
    const s = new SwipeRecognizer(24, 0.35);
    expect(s.end(1)).toBe('none');
  });
});

describe('InputState', () => {
  it('tracks the held key direction and clears it', () => {
    const i = new InputState();
    i.setHeld('left');
    expect(i.heldDir).toBe('left');
    i.clear();
    expect(i.heldDir).toBeNull();
  });

  it.each([30, 60, 120])('repeats held movement identically at %i render FPS', (fps) => {
    const w = freshWorld();
    w.occupancy.move(w.player.id, w.player.x, w.player.y, 1, 5);
    w.player.x = w.player.prevX = 1;
    w.player.y = w.player.prevY = 5;
    const input = new InputState();
    input.push({ type: 'move', dir: 'up' });
    input.setHeld('up');
    const clock = new FixedStepClock({ hz: 60, maxFrameTime: 0.25 });

    for (let frame = 0; frame < fps * 0.6; frame++) {
      const ticks = clock.advance(1 / fps);
      for (let n = 0; n < ticks; n++) w.step(clock.dt, { commands: input.drain(), held: input.heldDir });
    }

    expect([w.player.x, w.player.y, w.player.moves]).toEqual([1, 3, 2]);
  });

  it('drains queued commands once and bounds the queue', () => {
    const i = new InputState();
    for (let k = 0; k < 20; k++) i.push({ type: 'move', dir: 'up' });
    expect(i.drain()).toHaveLength(16);
    expect(i.drain()).toHaveLength(0);
  });
});
