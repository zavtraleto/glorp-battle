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
    expect(w.player.hp).toBe(100);
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

describe('SwipeRecognizer', () => {
  it('fires once the threshold is crossed, by dominant axis', () => {
    const s = new SwipeRecognizer(24, 0.35);
    s.begin(100, 100, 0);
    expect(s.move(110, 105)).toBeNull();
    expect(s.move(126, 110)).toBe('right');
  });

  it('one stroke yields exactly one step, however long', () => {
    const s = new SwipeRecognizer(24, 0.35);
    s.begin(0, 0, 0);
    expect(s.move(30, 0, 0.02)).toBe('right');
    expect(s.move(80, 0, 0.04)).toBeNull();
    expect(s.move(200, 3, 0.06)).toBeNull();
  });

  it('does not emit an extra discrete step after a rest in the same direction', () => {
    const s = new SwipeRecognizer(24, 0.35);
    s.begin(0, 0, 0);
    expect(s.move(30, 0, 0.02)).toBe('right');
    expect(s.move(40, 0, 0.12)).toBeNull();
    expect(s.move(70, 0, 0.14)).toBeNull();
  });

  it('does not emit another step while continuing the same stroke', () => {
    const s = new SwipeRecognizer(24, 0.35);
    s.begin(0, 0, 0);
    expect(s.move(30, 0, 0.02)).toBe('right');
    expect(s.move(70, 0, 0.06)).toBeNull();
  });

  it('steps again when the stroke turns, measured from where it turned', () => {
    const s = new SwipeRecognizer(24, 0.35);
    s.begin(0, 0, 0);
    expect(s.move(30, 0, 0.01)).toBe('right');
    expect(s.move(90, 0, 0.02)).toBeNull();
    expect(s.move(75, 0, 0.03)).toBeNull();
    expect(s.move(60, 0, 0.04)).toBe('left');
    expect(s.move(60, 30, 0.05)).toBe('down');
  });

  it('counts a gesture with steps as a step, not a tap', () => {
    const s = new SwipeRecognizer(24, 0.35);
    s.begin(0, 0, 0);
    s.move(30, 0, 0.02);
    s.move(40, 0, 0.12);
    s.move(70, 0, 0.14);
    expect(s.end(0.2)).toBe('step');
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

  it('keeps keyboard hold underneath an active pointer hold', () => {
    const i = new InputState();
    i.setHeld('left', 'keyboard');
    i.setHeld('up', 'pointer');
    expect(i.heldDir).toBe('up');
    i.setHeld(null, 'pointer');
    expect(i.heldDir).toBe('left');
  });

  it.each([30, 60, 120])('repeats held movement identically at %i render FPS', (fps) => {
    const w = freshWorld();
    w.occupancy.move(w.player.id, w.player.x, w.player.y, 1, 5);
    w.player.x = w.player.prevX = 1;
    w.player.y = w.player.prevY = 5;
    const input = new InputState();
    input.push({ type: 'move', dir: 'up' });
    input.setHeld('up', 'pointer');
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
