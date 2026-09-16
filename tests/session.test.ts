import { beforeEach, describe, expect, it } from 'vitest';
import { Session } from '../src/app/session';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { Command } from '../src/core/input/commands';
import { Shockwave } from '../src/sim/attacks/shockwave';

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);

beforeEach(() => {
  mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING)));
});

function make(): Session {
  return new Session({ seed: 42, cheats: { god: false, aiEnabled: false }, folder: 'mvp' });
}

function tick(s: Session, commands: Command[] = []): void {
  s.world.step(DT, { commands, held: null });
  s.world.drainEvents();
  s.update();
}
const run = (s: Session, n: number) => {
  for (let i = 0; i < n; i++) tick(s);
};

/** Intro → Custom (OK with nothing) → action. */
function enterAction(s: Session): void {
  run(s, T(tuning.fx.INTRO_TIME));
  s.world.customConfirm();
  run(s, T(tuning.fx.BANNER_BATTLE_START));
  expect(s.world.state).toBe('ACTION');
}

function win(s: Session): void {
  s.world.killAllEnemies();
  tick(s);
  run(s, T(tuning.fx.RESULT_DELAY_WIN));
}

describe('Session', () => {
  it('starts on the title with a frozen world', () => {
    const s = make();
    expect(s.screen).toBe('TITLE');
    run(s, 120);
    expect(s.world.state).toBe('TITLE');
    expect(s.world.tick).toBe(0);
  });

  it('Start begins battle 1 with full HP', () => {
    const s = make();
    s.start();
    expect(s.screen).toBe('BATTLE');
    expect(s.battleIndex).toBe(1);
    expect(s.world.state).toBe('BATTLE_INTRO');
    expect(s.world.player.hp).toBe(100);
  });

  it('shows the result after the win banner, then carries HP into the next battle', () => {
    const s = make();
    s.start();
    enterAction(s);
    s.world.player.hp = 64;
    s.world.killAllEnemies();
    tick(s);
    expect(s.screen).toBe('BATTLE');
    run(s, T(tuning.fx.RESULT_DELAY_WIN));
    expect(s.screen).toBe('RESULT');
    expect(s.lastResult).toMatchObject({ battle: 1, hpLeft: 64, hits: 0 });
    const v = s.worldVersion;
    s.next();
    expect(s.worldVersion).toBe(v + 1);
    expect(s.battleIndex).toBe(2);
    expect(s.world.battleIndex).toBe(2);
    expect(s.world.player.hp).toBe(64);
    expect(s.hpAtBattleStart).toBe(64);
  });

  it('defeat → Retry restores the HP from the start of the battle and reshuffles', () => {
    const s = make();
    s.start();
    enterAction(s);
    win(s);
    s.world.player.hp = 70; // HP left after battle 1
    s.next();
    enterAction(s);
    const firstSeed = s.world.seed;
    s.world.player.hp = 5;
    s.world.spawnAttack(new Shockwave(1, s.world.player.x, s.world.player.y, s.world.tick));
    tick(s);
    expect(s.world.state).toBe('PLAYER_DEAD');
    run(s, T(tuning.fx.RESULT_DELAY_LOSE));
    expect(s.screen).toBe('DEFEAT');
    s.retry();
    expect(s.screen).toBe('BATTLE');
    expect(s.battleIndex).toBe(2);
    expect(s.world.player.hp).toBe(70);
    expect(s.world.seed).not.toBe(firstSeed);
  });

  it('Restart goes back to battle 1 with full HP and clears results', () => {
    const s = make();
    s.start();
    enterAction(s);
    s.world.player.hp = 30;
    win(s);
    s.next();
    s.start(); // Restart = start from battle 1
    expect(s.battleIndex).toBe(1);
    expect(s.world.player.hp).toBe(100);
    expect(s.results).toHaveLength(0);
  });

  it('completes the sequence after the fourth battle', () => {
    const s = make();
    s.start();
    for (let b = 1; b <= 4; b++) {
      expect(s.battleIndex).toBe(b);
      enterAction(s);
      run(s, 30);
      win(s);
      expect(s.screen).toBe('RESULT');
      s.next();
    }
    expect(s.screen).toBe('COMPLETE');
    expect(s.results.map((r) => r.battle)).toEqual([1, 2, 3, 4]);
    expect(s.totalTime).toBeGreaterThan(0);
  });

  it('battle seeds are stable for the same session seed', () => {
    const a = make();
    const b = make();
    a.start();
    b.start();
    expect(a.world.seed).toBe(b.world.seed);
    expect(a.world.chips.hand).toEqual(b.world.chips.hand);
  });

  it('next() does nothing outside the result screen', () => {
    const s = make();
    s.start();
    s.next();
    expect(s.battleIndex).toBe(1);
  });
});

describe('pause', () => {
  it('freezes the battle and resumes where it left off', () => {
    const s = make();
    s.start();
    enterAction(s);
    run(s, 30);
    const tick0 = s.world.tick;
    const gauge0 = s.world.gauge.value;
    s.pause();
    expect(s.screen).toBe('PAUSED');
    expect(s.world.state).toBe('PAUSED');
    run(s, 300);
    expect(s.world.tick).toBe(tick0);
    expect(s.world.gauge.value).toBe(gauge0);
    s.resume();
    expect(s.screen).toBe('BATTLE');
    expect(s.world.state).toBe('ACTION');
    tick(s);
    expect(s.world.tick).toBe(tick0 + 1);
  });

  it('drops a held buster charge', () => {
    const s = make();
    s.start();
    enterAction(s);
    tick(s, [{ type: 'busterDown' }]);
    run(s, 30);
    s.pause();
    s.resume();
    expect(s.world.player.buster.held).toBe(false);
    expect(s.world.player.buster.chargeStartTick).toBeNull();
  });

  it('is ignored on the title and on the Custom Screen', () => {
    const s = make();
    s.pause();
    expect(s.screen).toBe('TITLE');
    s.start();
    run(s, T(tuning.fx.INTRO_TIME));
    expect(s.world.state).toBe('CUSTOM');
    s.pause();
    expect(s.screen).toBe('BATTLE');
    expect(s.world.state).toBe('CUSTOM');
  });

  it('Retry from the pause menu restarts the current battle', () => {
    const s = make();
    s.start();
    enterAction(s);
    s.pause();
    s.retry();
    expect(s.screen).toBe('BATTLE');
    expect(s.world.state).toBe('BATTLE_INTRO');
    expect(s.attempt).toBe(1);
  });
});
