import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import { e, wave, type Encounter } from '../src/data/encounters';
import type { SimEvent } from '../src/sim/events';
import { World } from '../src/sim/world';

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

const THREE_WAVES: Encounter = {
  id: 'waves', tier: 'normal', minDepth: 1, maxDepth: 1,
  waves: [
    wave(e('mettik', 1, 1)),
    wave(e('mettik', 0, 1), e('mettik', 2, 1)),
    wave(e('mettik', 0, 2), e('canodron', 2, 0)),
  ],
};

function make(startWave = 0): World {
  return new World({
    seed: 1, battleIndex: 1, encounter: THREE_WAVES, startWave, skipIntro: true,
    cheats: { god: true, aiEnabled: false },
  });
}

function run(w: World, n: number, log: SimEvent[] = []): SimEvent[] {
  for (let i = 0; i < n; i++) {
    w.step(DT);
    log.push(...w.drainEvents());
  }
  return log;
}

/** Kills the wave and plays the whole transition to the next wave's ACTION. */
function clearWave(w: World, log: SimEvent[] = []): SimEvent[] {
  w.killAllEnemies();
  run(w, 1, log);
  expect(w.state).toBe('WAVE_CLEAR');
  run(w, T(tuning.flow.WAVE_CLEAR_TIME) + T(tuning.flow.WAVE_SPAWN_TIME) + 1, log);
  expect(w.state).toBe('ACTION');
  return log;
}

const kinds = (w: World) => w.enemies.map((enemy) => enemy.kind);

describe('waves (GDD §10.4)', () => {
  it('the next wave comes only after every enemy of the current one is deleted', () => {
    const w = make(1);
    const [first] = w.enemies;
    w.damageEnemy(first!, first!.hp);
    run(w, 2);
    expect(w.state).toBe('ACTION');
    expect(w.waveIndex).toBe(1);
  });

  it('plays the waves in order and wins only after the last one', () => {
    const w = make();
    expect(kinds(w)).toEqual(['mettik']);
    const log = clearWave(w);
    expect(w.waveIndex).toBe(1);
    expect(kinds(w)).toEqual(['mettik', 'mettik']);
    clearWave(w, log);
    expect(kinds(w)).toEqual(['mettik', 'canodron']);
    w.killAllEnemies();
    run(w, 1, log);
    expect(w.state).toBe('BATTLE_WON');
    const waveEvents = log.filter((ev) => ev.type.startsWith('wave')).map((ev) => `${ev.type}:${(ev as { wave: number }).wave}`);
    expect(waveEvents).toEqual([
      'waveCleared:1', 'waveField:2', 'waveSpawned:2',
      'waveCleared:2', 'waveField:3', 'waveSpawned:3',
    ]);
  });

  it('does not restart the battle: HP, clocks and the folder carry on', () => {
    const w = make();
    w.player.hp = 7;
    run(w, 30);
    const time = w.time;
    const chips = w.chips.chips;
    clearWave(w);
    expect(w.player.hp).toBe(7);
    expect(w.time).toBeGreaterThan(time);
    expect(w.chips.chips).toBe(chips);
  });

  it('resets the field in place as the next wave begins; the player keeps its cell', () => {
    const w = make();
    w.field.breakPanel(1, 3, w.tick, false);
    w.field.setOwner(0, 2, 'player', w.tick);
    w.field.arm(2, 1, { kind: 'mine', side: 'player', damage: 1 });
    w.placeObject('rock', 0, 3, 'player');
    w.player.x = 0;
    w.player.y = 5;
    w.occupancy.remove(w.player.id, 1, 4);
    w.occupancy.place(w.player.id, 0, 5);
    w.player.guard = true;

    w.killAllEnemies();
    run(w, 1);
    run(w, T(tuning.flow.WAVE_CLEAR_TIME) - 1);
    expect(w.state).toBe('WAVE_CLEAR');
    // The old field stays while the deletions play out.
    expect(w.field.panel(1, 3)).toBe('BROKEN');
    const log = run(w, 1);
    expect(w.state).toBe('WAVE_INTRO');
    expect(log.map((ev) => ev.type)).toEqual(expect.arrayContaining(['waveField', 'waveSpawned']));
    expect(w.field.panel(1, 3)).toBe('NORMAL');
    expect(w.field.owner(0, 2)).toBe('enemy');
    expect(w.field.hazard(2, 1)).toBeNull();
    expect(w.objects).toHaveLength(0);
    expect(w.occupancy.isFree(0, 3)).toBe(true);
    expect({ x: w.player.x, y: w.player.y }).toEqual({ x: 0, y: 5 });
    expect(w.occupancy.get(0, 5)).toBe(w.player.id);
    expect(w.player.guard).toBe(false);
    expect(w.enemies.map((en) => [en.x, en.y])).toEqual([[0, 1], [2, 1]]);
  });

  it('sends the player to the start cell when the reset takes its panel away', () => {
    const w = make();
    // A grabbed enemy row: after the reset it belongs to the enemy again.
    w.field.setOwner(0, 2, 'player', w.tick);
    w.occupancy.remove(w.player.id, w.player.x, w.player.y);
    w.player.x = 0;
    w.player.y = 2;
    w.occupancy.place(w.player.id, 0, 2);
    w.killAllEnemies();
    run(w, 1 + T(tuning.flow.WAVE_CLEAR_TIME));
    expect(w.state).toBe('WAVE_INTRO');
    expect({ x: w.player.x, y: w.player.y }).toEqual({ x: tuning.player.PLAYER_START_X, y: tuning.player.PLAYER_START_Y });
    expect(w.occupancy.isFree(0, 2)).toBe(true);
  });

  it('the new wave is frozen while it materializes', () => {
    const w = make();
    const x = w.player.x;
    w.killAllEnemies();
    run(w, 1 + T(tuning.flow.WAVE_CLEAR_TIME) + 1);
    expect(w.state).toBe('WAVE_INTRO');
    expect(w.simFrozen).toBe(true);
    expect(w.enemies).toHaveLength(2);
    const tick = w.tick;
    w.step(DT, { commands: [{ type: 'move', dir: 'left' }], held: null });
    expect(w.tick).toBe(tick);
    expect(w.player.x).toBe(x);
    run(w, T(tuning.flow.WAVE_SPAWN_TIME));
    expect(w.state).toBe('ACTION');
  });

  it('a wave cleared mid-combo still unlocks the hand (no softlock)', () => {
    const w = make();
    for (const enemy of w.enemies) enemy.hp = 10_000;
    let uid = 90_000;
    for (const defId of ['cannon', 'cannon', 'cannon'] as const) {
      w.giveChip({ uid: uid++, defId, state: 'queued', deal: 0 });
    }
    w.step(DT, { commands: [{ type: 'useChip' }], held: null });
    expect(w.combo).not.toBeNull();
    clearWave(w);
    expect(w.combo).toBeNull();
    run(w, T(tuning.hand.REFILL_COOLDOWN) + 1);
    expect(w.chips.phase).toBe('selecting');
    expect(w.chips.hand.some((chip, slot) => chip && w.chips.canSelect(slot))).toBe(true);
  });

  it('a wave cleared before the active chip lands returns it to its slot', () => {
    const w = make();
    const slot = w.chips.hand.findIndex((chip) => chip !== null);
    w.selectChip(slot);
    const chip = w.chips.hand[slot];
    w.step(DT, { commands: [{ type: 'useChip' }], held: null });
    if (w.activeChip?.resolved !== false) return; // chips that land on their first tick have nothing to return
    clearWave(w);
    expect(w.chips.hand[slot]).toBe(chip);
  });

  it('?wave= starts from the requested wave, clamped', () => {
    expect(kinds(make(2))).toEqual(['mettik', 'canodron']);
    expect(make(9).waveIndex).toBe(2);
    expect(make(-3).waveIndex).toBe(0);
  });
});
