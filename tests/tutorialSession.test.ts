import { beforeEach, describe, expect, it } from 'vitest';
import { Session } from '../src/app/session';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { Command, Dir } from '../src/core/input/commands';

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

/** Enemy AI off: the Mettiks stand still, so lining up is up to the test. */
function make(): Session {
  return new Session({ seed: 42, cheats: { god: false, aiEnabled: false }, folder: 'starter' });
}

function tick(s: Session, commands: Command[] = []): void {
  s.world.step(DT, { commands, held: null });
  s.update(s.world.drainEvents());
}
const run = (s: Session, n: number) => {
  for (let i = 0; i < n; i++) tick(s);
};
const move = (s: Session, dir: Dir) => {
  tick(s, [{ type: 'move', dir }]);
  run(s, T(tuning.player.CELL_MOVE_TIME) + 1);
};
const tap = (s: Session, slot: number) => tick(s, [{ type: 'selectChip', slot }]);
const attack = (s: Session) => tick(s, [{ type: 'useChip' }]);
const word = (s: Session) => s.tutorialCallout()?.text ?? null;

/** Ticks until a callout is up (or the limit runs out). */
function untilCallout(s: Session, limit = 60 * 10): void {
  for (let i = 0; i < limit && !s.tutorialCallout(); i++) tick(s);
}

/** Ticks until wave `index` (0-based) is in ACTION. */
function untilWave(s: Session, index: number): void {
  for (let i = 0; i < 60 * 10 && !(s.world.waveIndex === index && s.world.state === 'ACTION'); i++) tick(s);
  tick(s);
}

function start(s: Session): void {
  s.startTutorial();
  untilWave(s, 0);
}

describe('tutorial mode', () => {
  it('starts from the title into one battle of four waves, one Mettik, no chips', () => {
    const s = make();
    s.startTutorial();
    expect(s.mode).toBe('tutorial');
    expect(s.screen).toBe('BATTLE');
    expect(s.run).toBeNull();
    expect(s.world.waveCount).toBe(4);
    expect(s.world.enemies).toHaveLength(1);
    expect(s.world.chips.hand.every((c) => c === null)).toBe(true);
  });

  it('never kills the player', () => {
    const s = make();
    start(s);
    const p = s.world.player;
    p.hp = 5;
    p.iframeTicks = 0;
    const hit = { id: -3, kind: 'instant', hitIds: new Set<number>(), done: true, update: () => undefined };
    s.world.hitPlayerAt(hit, p.x, p.y, 999);
    expect(p.hp).toBe(1);
  });

  it('opens on MOVE: the battle stands still until a real step', () => {
    const s = make();
    start(s);
    expect(s.tutorialCallout()).toEqual({ text: 'MOVE', targets: ['trackball'], arrows: true });
    expect(s.world.simFrozen).toBe(true);
    const time = s.world.time;
    run(s, 30);
    attack(s);
    tap(s, 0);
    expect(s.world.time).toBe(time);
    expect(word(s)).toBe('MOVE');
    move(s, 'left');
    expect(s.tutorialCallout()).toBeNull();
    expect(s.world.time).toBeGreaterThan(time);
  });

  it('plays the whole script: MOVE, SELECT, ATTACK, SELECT TWO, AGAIN, AreaGrab + Sword, the exam', () => {
    const s = make();
    start(s);
    move(s, 'left');

    // Lesson 1: free movement, then the Cannon arrives in the leftmost slot.
    run(s, T(tuning.tutorial.TUT_FREE_MOVE) - T(tuning.player.CELL_MOVE_TIME) - 10);
    expect(s.tutorialCallout()).toBeNull();
    untilCallout(s);
    expect(s.tutorialCallout()).toEqual({ text: 'SELECT', targets: [0], arrows: true });
    expect(s.world.chips.hand[0]?.defId).toBe('cannon');
    tap(s, 0);
    tick(s);
    expect(s.tutorialCallout()).toBeNull();
    // Off the Mettik's lane: no ATTACK yet.
    run(s, 30);
    expect(s.tutorialCallout()).toBeNull();
    move(s, 'right');
    untilCallout(s, 90);
    expect(s.tutorialCallout()).toEqual({ text: 'ATTACK', targets: ['trackball'], arrows: true });
    attack(s);
    untilWave(s, 1);

    // Lesson 2: two Cannons, one callout for both, AGAIN before the second shot.
    untilCallout(s, 90);
    expect(s.tutorialCallout()).toEqual({ text: 'SELECT TWO', targets: [0, 1], arrows: true });
    tap(s, 0);
    tick(s);
    expect(s.tutorialCallout()?.targets).toEqual([1]);
    tap(s, 1);
    tick(s);
    expect(s.tutorialCallout()).toBeNull();
    // The start cell already faces the middle Mettik: the first shot needs no callout.
    run(s, 30);
    expect(s.tutorialCallout()).toBeNull();
    attack(s);
    run(s, 30);
    expect(s.world.enemies.filter((e) => e.alive)).toHaveLength(1);
    move(s, 'left');
    untilCallout(s, 90);
    expect(word(s)).toBe('AGAIN');
    attack(s);
    untilWave(s, 2);

    // Lesson 3: one SELECT without arrows, lifted by either chip; then no callouts at all.
    untilCallout(s, 90);
    expect(s.tutorialCallout()).toEqual({ text: 'SELECT', targets: [0, 1], arrows: false });
    tap(s, 1);
    tick(s);
    expect(s.tutorialCallout()).toBeNull();
    tap(s, 1);
    tap(s, 0);
    tap(s, 1);
    expect(s.world.chips.attack).toEqual([0, 1]);
    attack(s);
    run(s, 30);
    expect(s.world.field.owner(1, 2)).toBe('player');
    move(s, 'up');
    move(s, 'up');
    run(s, 120);
    expect(s.tutorialCallout()).toBeNull();
    attack(s);
    untilWave(s, 3);

    // Lesson 4: the whole hand, no callouts.
    expect(s.world.chips.hand.map((c) => c?.defId ?? null)).toEqual(['cannon', 'cannon', 'sword', 'areagrab', null]);
    expect(s.world.enemies).toHaveLength(3);
    run(s, 60);
    expect(s.tutorialCallout()).toBeNull();
    s.world.killAllEnemies();
    run(s, T(tuning.flow.RESULT_DELAY_WIN) + 2);
    expect(s.screen).toBe('COMPLETE');
    s.toTitle();
    expect(s.screen).toBe('TITLE');
    expect(s.mode).toBe('run');
    expect(s.run).toBeNull();
  });

  it('keeps at least TUT_CALLOUT_GAP between callouts and waits for the slide into the cell', () => {
    const s = make();
    s.debugTutorial(2);
    untilWave(s, 1);
    untilCallout(s, 90);
    tap(s, 0);
    tap(s, 1);
    attack(s);
    run(s, 30);
    // One step over to the Mettik behind; AGAIN waits for the slide into the cell.
    tick(s, [{ type: 'move', dir: 'left' }]);
    const stepped = s.world.playerTick;
    untilCallout(s, 90);
    expect(word(s)).toBe('AGAIN');
    expect(s.world.playerTick - stepped).toBeGreaterThanOrEqual(tuning.player.CELL_MOVE_TIME * tuning.sim.SIM_HZ);
  });

  it('waits TUT_CALLOUT_GAP after a callout closes before the next one', () => {
    const s = make();
    start(s);
    tuning.tutorial.TUT_FREE_MOVE = 0;
    move(s, 'left');
    const closed = s.world.uiTick - T(tuning.player.CELL_MOVE_TIME) - 2;
    untilCallout(s, 180);
    expect(word(s)).toBe('SELECT');
    expect(s.world.uiTick - closed).toBeGreaterThanOrEqual(T(tuning.tutorial.TUT_CALLOUT_GAP));
  });

  it('swaps the chips during the flight to the next lesson', () => {
    const s = make();
    s.debugTutorial(1);
    untilWave(s, 0);
    move(s, 'left');
    s.world.killAllEnemies();
    for (let i = 0; i < 600 && s.world.state !== 'WAVE_INTRO'; i++) tick(s);
    const version = s.world.chips.folderVersion;
    for (let i = 0; i < 600 && s.world.state === 'WAVE_INTRO'; i++) tick(s);
    expect(s.world.chips.folderVersion).toBe(version + 1);
    expect(s.world.chips.hand.slice(0, 2).map((c) => c?.defId)).toEqual(['cannon', 'cannon']);
  });

  it('goes round again after a missed Cannon', () => {
    const s = make();
    start(s);
    move(s, 'left');
    untilCallout(s);
    tap(s, 0);
    // Fired off the lane, on the player's own: a miss.
    attack(s);
    run(s, 30);
    expect(s.world.enemies[0]?.alive).toBe(true);
    untilCallout(s, T(tuning.hand.REFILL_COOLDOWN) + 120);
    expect(s.tutorialCallout()?.text).toBe('SELECT');
  });

  it('abandon from the pause menu returns to the title, not GAME_OVER', () => {
    const s = make();
    start(s);
    s.pause();
    expect(s.screen).toBe('PAUSED');
    expect(s.tutorialCallout()).toBeNull();
    s.abandon();
    expect(s.screen).toBe('TITLE');
    expect(s.mode).toBe('run');
  });

  it('shows no callout outside the tutorial', () => {
    const s = make();
    s.start();
    expect(s.tutorialCallout()).toBeNull();
  });

  describe('debug', () => {
    it('starts from any lesson with that lesson’s chips', () => {
      const s = make();
      s.debugTutorial(3);
      untilWave(s, 2);
      expect(s.world.chips.hand.slice(0, 2).map((c) => c?.defId)).toEqual(['areagrab', 'sword']);
      untilCallout(s, 90);
      expect(word(s)).toBe('SELECT');
    });

    it('skips a callout by doing it, and the last beat by deleting the wave', () => {
      const s = make();
      s.debugTutorial(2);
      untilWave(s, 1);
      s.debugSkipTutorialBeat();
      expect(s.world.chips.attack).toHaveLength(2);
      expect(s.world.hold).toBeNull();
      s.debugSkipTutorialBeat(); // 'first' → 'again' waits for a hit
      s.debugSkipTutorialBeat(); // 'again' → 'clear'
      s.debugSkipTutorialBeat(); // 'clear' deletes the wave
      untilWave(s, 2);
      expect(s.world.waveIndex).toBe(2);
    });
  });
});
