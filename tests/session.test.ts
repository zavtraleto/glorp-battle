import { beforeEach, describe, expect, it } from 'vitest';
import { RUN_STEPS } from '../src/app/run';
import { Session } from '../src/app/session';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { Command } from '../src/core/input/commands';
import { Shockwave } from '../src/sim/attacks/shockwave';
import { folderChips } from '../src/sim/chips/chipSystem';

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);

beforeEach(() => {
  mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING)));
});

function make(): Session {
  return new Session({ seed: 42, cheats: { god: false, aiEnabled: false }, folder: 'starter' });
}

function tick(s: Session, commands: Command[] = []): void {
  s.world.step(DT, { commands, held: null });
  const events = s.world.drainEvents();
  s.update(events);
}
const run = (s: Session, n: number) => {
  for (let i = 0; i < n; i++) tick(s);
};

/** Intro → action; the hand is dealt on the way (GDD §7.6). */
function enterAction(s: Session): void {
  run(s, T(tuning.flow.INTRO_TIME) + 1);
  expect(s.world.state).toBe('ACTION');
}

/** Clears every wave of the encounter (GDD §10.4), then the win signal plays. */
function win(s: Session): void {
  for (;;) {
    s.world.killAllEnemies();
    tick(s);
    if (s.world.state === 'BATTLE_WON') break;
    expect(s.world.state).toBe('WAVE_CLEAR');
    while (s.world.state !== 'ACTION') tick(s);
  }
  run(s, T(tuning.flow.RESULT_DELAY_WIN));
}

function die(s: Session): void {
  const p = s.world.player;
  p.hp = 1;
  p.iframeTicks = 0;
  s.world.spawnAttack(new Shockwave(1, p.x, p.y, s.world.tick));
  tick(s);
  expect(s.world.state).toBe('PLAYER_DEAD');
  run(s, T(tuning.flow.RESULT_DELAY_LOSE));
}

describe('Session', () => {
  it('starts on the title with a frozen world', () => {
    const s = make();
    expect(s.screen).toBe('TITLE');
    run(s, 120);
    expect(s.world.state).toBe('TITLE');
    expect(s.world.tick).toBe(0);
  });

  it('Start opens the path with the next encounter; Fight starts it', () => {
    const s = make();
    s.start();
    expect(s.screen).toBe('PATH');
    expect(s.folderSize).toBe(folderChips('starter').length);
    const encounter = s.run!.encounter;
    expect(s.next).toEqual({ kind: encounter.tier, enemies: encounter.waves[0]!.enemies.length });
    s.fight();
    expect(s.screen).toBe('BATTLE');
    expect(s.world.encounter.id).toBe(encounter.id);
    expect(s.world.enemies.map((e) => e.kind)).toEqual(encounter.waves[0]!.enemies.map((e) => e.kind));
    expect(s.world.chips.chips).toHaveLength(folderChips('starter').length);
    expect(s.world.player.hp).toBe(s.world.player.maxHp);
  });

  it('a win goes straight to the next step with HP and the folder carried over', () => {
    const s = make();
    s.start();
    s.fight();
    enterAction(s);
    s.world.player.hp = 6;
    win(s);
    expect(s.screen).toBe('PATH');
    expect(s.run!.depth).toBe(2);
    expect(s.hp).toBe(6);
    expect(s.folderSize).toBe(folderChips('starter').length);
    s.fight();
    expect(s.world.player.hp).toBe(6);
    expect(s.lastResult).toMatchObject({ battle: 1, hpLeft: 6 });
  });

  it('death leads to GAME OVER, then back to the title', () => {
    const s = make();
    s.start();
    s.fight();
    enterAction(s);
    die(s);
    expect(s.screen).toBe('GAME_OVER');
    s.toTitle();
    expect(s.screen).toBe('TITLE');
  });

  it('clearing every Play stage completes the run', () => {
    const s = make();
    s.start();
    for (let step = 1; step <= RUN_STEPS; step++) {
      expect(s.screen).toBe('PATH');
      s.fight();
      enterAction(s);
      win(s);
    }
    expect(s.screen).toBe('COMPLETE');
    expect(s.results).toHaveLength(RUN_STEPS);
    expect(s.totalTime).toBeGreaterThanOrEqual(0);
    s.toTitle();
    expect(s.screen).toBe('TITLE');
  });

  it('abandoning from the pause menu counts as a death', () => {
    const s = make();
    s.start();
    s.fight();
    enterAction(s);
    s.pause();
    s.abandon();
    expect(s.screen).toBe('GAME_OVER');
  });

  it('battle seeds are stable for the same session seed', () => {
    const a = make();
    const b = make();
    a.start();
    b.start();
    a.fight();
    b.fight();
    expect(a.world.seed).toBe(b.world.seed);
    expect(a.world.chips.hand).toEqual(b.world.chips.hand);
  });

  it('debug jumps start a battle with the debug folder', () => {
    const s = make();
    s.debugJump(3);
    expect(s.screen).toBe('BATTLE');
    expect(s.world.encounter.id).toBe('n3');
    expect(s.world.chips.chips).toHaveLength(folderChips('starter').length);
    expect(s.debugEncounter('e1')).toBe(true);
    expect(s.world.enemies.map((e) => e.kind)).toEqual(['bladdy', 'mettik']);
    expect(s.debugEncounter('nope')).toBe(false);
  });

  it('runs a Lab encounter from any wave with the chosen folder', () => {
    const s = make();
    const enc = { id: 'lab', tier: 'normal' as const, minDepth: 1, maxDepth: 1, waves: [{ enemies: [{ kind: 'mettik' as const, x: 1, y: 1 }] }, { enemies: [{ kind: 'punchy' as const, x: 1, y: 0 }] }] };
    s.debugCustom(enc, 'all', 2);
    expect(s.screen).toBe('BATTLE');
    expect(s.world.enemies.map((e) => e.kind)).toEqual(['punchy']);
    expect(s.world.chips.chips).toHaveLength(folderChips('all').length);
  });

  it('PATH shows the debug folder size after a debug jump', () => {
    const s = new Session({ seed: 42, cheats: { god: false, aiEnabled: false }, folder: 'all' });
    s.debugJump(1);
    expect(s.folderSize).toBe(folderChips('all').length);
    expect(s.world.chips.chips).toHaveLength(s.folderSize);
  });
});

describe('pause', () => {
  it('freezes the battle and resumes where it left off', () => {
    const s = make();
    s.start();
    s.fight();
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
    s.fight();
    run(s, T(tuning.flow.INTRO_TIME) - 1);
    expect(s.world.state).toBe('BATTLE_INTRO');
    s.pause();
    expect(s.screen).toBe('BATTLE');
    expect(s.world.state).toBe('BATTLE_INTRO');
  });
});
