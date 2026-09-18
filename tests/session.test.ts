import { beforeEach, describe, expect, it } from 'vitest';
import type { LegacyStorage } from '../src/app/legacyStore';
import { Session } from '../src/app/session';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { Command } from '../src/core/input/commands';
import { STARTER_FOLDER } from '../src/data/starterFolder';
import { Shockwave } from '../src/sim/attacks/shockwave';

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);

beforeEach(() => {
  mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING)));
});

class MemoryStorage implements LegacyStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

function make(storage: LegacyStorage | null = null): Session {
  return new Session({ seed: 42, cheats: { god: false, aiEnabled: false, buster: false }, folder: 'mvp', storage });
}

function tick(s: Session, commands: Command[] = []): void {
  s.world.step(DT, { commands, held: null });
  s.world.drainEvents();
  s.update();
}
const run = (s: Session, n: number) => {
  for (let i = 0; i < n; i++) tick(s);
};

/** Intro → action; the hand is dealt on the way (GDD §7.6). */
function enterAction(s: Session): void {
  run(s, T(tuning.fx.INTRO_TIME) + 1);
  expect(s.world.state).toBe('ACTION');
}

function win(s: Session): void {
  s.world.killAllEnemies();
  tick(s);
  run(s, T(tuning.fx.RESULT_DELAY_WIN));
}

function die(s: Session): void {
  const p = s.world.player;
  p.hp = 5;
  p.iframeTicks = 0;
  s.world.spawnAttack(new Shockwave(1, p.x, p.y, s.world.tick));
  tick(s);
  expect(s.world.state).toBe('PLAYER_DEAD');
  run(s, T(tuning.fx.RESULT_DELAY_LOSE));
}

describe('Session', () => {
  it('starts on the title with a frozen world', () => {
    const s = make();
    expect(s.screen).toBe('TITLE');
    run(s, 120);
    expect(s.world.state).toBe('TITLE');
    expect(s.world.tick).toBe(0);
    expect(s.generation).toBe(1);
  });

  it('Start opens the path with 2–3 battles; a choice starts that encounter', () => {
    const s = make();
    s.start();
    expect(s.screen).toBe('PATH');
    expect(s.path.length).toBeGreaterThanOrEqual(2);
    expect(s.folderSize).toBe(STARTER_FOLDER.length);
    const option = s.run!.options[1]!;
    s.choosePath(1);
    expect(s.screen).toBe('BATTLE');
    expect(s.world.encounter.id).toBe(option.encounter.id);
    expect(s.world.enemies.map((e) => e.kind)).toEqual(option.encounter.enemies.map((e) => e.kind));
    expect(s.world.chips.chips).toHaveLength(STARTER_FOLDER.length);
    expect(s.world.player.hp).toBe(100);
  });

  it('a win gives a reward pick, then the next step with HP carried over', () => {
    const s = make();
    s.start();
    s.choosePath(0);
    enterAction(s);
    s.world.player.hp = 64;
    win(s);
    expect(s.screen).toBe('REWARD');
    expect(s.reward!.hand).toHaveLength(3);
    const picked = s.reward!.chips[2]!;
    expect(s.reward!.selectAt(2, 0)).toBe(true);
    s.takeReward();
    expect(s.screen).toBe('PATH');
    expect(s.depth).toBe(2);
    expect(s.hp).toBe(64);
    expect(s.run!.folder[s.run!.folder.length - 1]).toEqual(picked);
    s.choosePath(0);
    expect(s.world.player.hp).toBe(64);
    expect(s.lastResult).toMatchObject({ battle: 1, hpLeft: 64 });
  });

  it('skipping the reward keeps the folder', () => {
    const s = make();
    s.start();
    s.choosePath(0);
    enterAction(s);
    win(s);
    s.skipReward();
    expect(s.screen).toBe('PATH');
    expect(s.folderSize).toBe(STARTER_FOLDER.length);
  });

  it('death leads to the legacy pick, which the next run inherits', () => {
    const storage = new MemoryStorage();
    const s = make(storage);
    s.start();
    s.choosePath(0);
    enterAction(s);
    die(s);
    expect(s.screen).toBe('LEGACY');
    const choices = s.legacyChoices;
    expect(choices.length).toBeGreaterThan(0);
    s.chooseLegacy(1);
    expect(s.screen).toBe('TITLE');
    expect(s.generation).toBe(2);

    const next = make(storage);
    expect(next.generation).toBe(2);
    next.start();
    const inherited = next.run!.folder[next.run!.folder.length - 1]!;
    expect(inherited).toEqual({ defId: choices[1]!.defId, code: choices[1]!.code, legacyGen: 1 });
    // The chip is handed over once.
    expect(make(storage).legacy.chip).toBeNull();
  });

  it('clearing the boss completes the run without a legacy', () => {
    const storage = new MemoryStorage();
    const s = make(storage);
    s.start();
    for (let step = 1; step <= 10; step++) {
      expect(s.screen).toBe('PATH');
      s.choosePath(0);
      enterAction(s);
      win(s);
      if (step < 10) s.skipReward();
    }
    expect(s.screen).toBe('COMPLETE');
    expect(s.results).toHaveLength(10);
    expect(s.totalTime).toBeGreaterThanOrEqual(0);
    s.toTitle();
    expect(s.screen).toBe('TITLE');
    expect(s.generation).toBe(1);
  });

  it('abandoning from the pause menu counts as a death', () => {
    const s = make();
    s.start();
    s.choosePath(0);
    enterAction(s);
    s.pause();
    s.abandon();
    expect(s.screen).toBe('LEGACY');
  });

  it('battle seeds are stable for the same session seed', () => {
    const a = make();
    const b = make();
    a.start();
    b.start();
    a.choosePath(0);
    b.choosePath(0);
    expect(a.world.seed).toBe(b.world.seed);
    expect(a.world.chips.hand).toEqual(b.world.chips.hand);
  });

  it('debug jumps start a battle with the debug folder', () => {
    const s = make();
    s.debugJump(3);
    expect(s.screen).toBe('BATTLE');
    expect(s.world.encounter.id).toBe('n3');
    expect(s.world.chips.chips).toHaveLength(30);
    expect(s.debugEncounter('boss')).toBe(true);
    expect(s.world.enemies.some((e) => e.kind === 'monolith')).toBe(true);
    expect(s.debugEncounter('nope')).toBe(false);
  });
});

describe('pause', () => {
  it('freezes the battle and resumes where it left off', () => {
    const s = make();
    s.start();
    s.choosePath(0);
    enterAction(s);
    run(s, 30);
    const tick0 = s.world.tick;
    s.pause();
    expect(s.screen).toBe('PAUSED');
    expect(s.world.state).toBe('PAUSED');
    run(s, 300);
    expect(s.world.tick).toBe(tick0);
    s.resume();
    expect(s.screen).toBe('BATTLE');
    expect(s.world.state).toBe('ACTION');
    tick(s);
    expect(s.world.tick).toBe(tick0 + 1);
  });

  it('is ignored on the title and during the intro', () => {
    const s = make();
    s.pause();
    expect(s.screen).toBe('TITLE');
    s.start();
    s.choosePath(0);
    run(s, T(tuning.fx.INTRO_TIME) - 1);
    expect(s.world.state).toBe('BATTLE_INTRO');
    s.pause();
    expect(s.screen).toBe('BATTLE');
    expect(s.world.state).toBe('BATTLE_INTRO');
  });
});
