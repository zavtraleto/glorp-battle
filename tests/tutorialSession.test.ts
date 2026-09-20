import { beforeEach, describe, expect, it } from 'vitest';
import { Session } from '../src/app/session';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { Command } from '../src/core/input/commands';

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

function make(): Session {
  return new Session({ seed: 42, cheats: { god: false, aiEnabled: false }, folder: 'basic' });
}

function tick(s: Session, commands: Command[] = []): void {
  s.world.step(DT, { commands, held: null });
  const events = s.world.drainEvents();
  s.update(DT, events);
}
const run = (s: Session, n: number) => {
  for (let i = 0; i < n; i++) tick(s);
};

function enterAction(s: Session): void {
  run(s, T(tuning.fx.INTRO_TIME) + 1);
  expect(s.world.state).toBe('ACTION');
}

function win(s: Session): void {
  s.world.killAllEnemies();
  tick(s);
  run(s, T(tuning.fx.RESULT_DELAY_WIN));
}

describe('tutorial mode', () => {
  it('starts from the title into the first tutorial battle', () => {
    const s = make();
    s.startTutorial();
    expect(s.mode).toBe('tutorial');
    expect(s.screen).toBe('BATTLE');
    expect(s.run).toBeNull();
    expect(s.world.enemies).toHaveLength(1);
    expect(s.world.chips.hand.every((c) => c === null)).toBe(true);
  });

  it('never kills the player', () => {
    const s = make();
    s.startTutorial();
    enterAction(s);
    const p = s.world.player;
    p.hp = 5;
    p.iframeTicks = 0;
    const attack = { id: -3, kind: 'instant', hitIds: new Set<number>(), done: true, update: () => undefined };
    s.world.hitPlayerAt(attack, p.x, p.y, 999);
    expect(p.hp).toBe(1);
    expect(p.alive).toBe(true);
  });

  it('walks through all four battles and ends on COMPLETE', () => {
    const s = make();
    s.startTutorial();
    for (let i = 0; i < 4; i++) {
      enterAction(s);
      expect(s.screen).toBe('BATTLE');
      win(s);
    }
    expect(s.screen).toBe('COMPLETE');
    expect(s.tutorial).toBe(true);
  });

  it('goes back to the title without starting a run', () => {
    const s = make();
    s.startTutorial();
    for (let i = 0; i < 4; i++) {
      enterAction(s);
      win(s);
    }
    s.toTitle();
    expect(s.screen).toBe('TITLE');
    expect(s.mode).toBe('run');
    expect(s.run).toBeNull();
  });

  it('abandon from the pause menu returns to the title, not GAME_OVER', () => {
    const s = make();
    s.startTutorial();
    enterAction(s);
    s.pause();
    expect(s.screen).toBe('PAUSED');
    s.abandon();
    expect(s.screen).toBe('TITLE');
    expect(s.mode).toBe('run');
  });

  it('reports a hint after the player stalls', () => {
    const s = make();
    s.startTutorial();
    enterAction(s);
    expect(s.tutorialHint()?.level).toBe(0);
    run(s, T(tuning.tutorial.TUT_HINT_SEG) + 2);
    const hint = s.tutorialHint();
    expect(hint?.level).toBeGreaterThanOrEqual(2);
    expect(hint?.seg).toBe('SWIPE BALL');
  });

  it('gives no hint outside the tutorial', () => {
    const s = make();
    s.start('basic');
    expect(s.tutorialHint()).toBeNull();
  });

  it('plays battle 1 for real: steps, a survived wave, the cassette, the kill', () => {
    const s = new Session({ seed: 42, cheats: { god: false, aiEnabled: true }, folder: 'basic' });
    s.startTutorial();
    enterAction(s);
    for (const dir of ['left', 'right', 'left'] as const) {
      tick(s, [{ type: 'move', dir }]);
      run(s, T(tuning.player.MOVE_COOLDOWN) + 2);
    }
    // The Mettik swings on its own; the cassette arrives when the beat passes.
    for (let i = 0; i < 60 * 20 && s.world.chips.hand[2] === null; i++) tick(s);
    expect(s.world.chips.hand[2]?.defId).toBe('cannon');
    expect(s.world.chips.attack).toEqual([]);
    // Line the Mettik up and shoot it: 40 damage is exactly its HP.
    const enemy = s.world.enemies[0];
    expect(enemy).toBeDefined();
    tick(s, [{ type: 'selectChip', slot: 2 }]);
    (enemy as { x: number }).x = s.world.player.x;
    tick(s, [{ type: 'useChip' }]);
    run(s, T(tuning.chips.CHIP_USE_TIME_CANNON) + 2);
    expect(enemy?.alive).toBe(false);
    // The win rolls straight into battle 2 with three cassettes in the rail.
    run(s, T(tuning.fx.RESULT_DELAY_WIN) + T(tuning.fx.INTRO_TIME) + 2);
    expect(s.screen).toBe('BATTLE');
    expect(s.world.chips.hand.filter((c) => c !== null)).toHaveLength(3);
  });

  it('blocks the odd chip once a Cannon is queued in battle 2', () => {
    const s = make();
    s.startTutorial();
    enterAction(s);
    win(s);
    enterAction(s);
    expect(s.world.chips.hand[2]?.defId).toBe('shotgun');
    expect(s.world.chips.slotState(2)).toBe('ready');
    tick(s, [{ type: 'selectChip', slot: 0 }]);
    expect(s.world.chips.slotState(0)).toBe('queued');
    expect(s.world.chips.slotState(1)).toBe('ready');
    expect(s.world.chips.slotState(2)).toBe('blocked');
  });
});
