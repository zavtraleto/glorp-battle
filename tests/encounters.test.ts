import { describe, expect, it } from 'vitest';
import { debugEncounter, encounterById, ENCOUNTERS, STAGES, type Encounter } from '../src/data/encounters';
import { sideOfRow } from '../src/sim/grid';
import { World } from '../src/sim/world';

const CURRENT_ENEMIES = new Set(['mettik', 'canodron', 'hopzap', 'bladdy', 'punchy']);

function checkWaves(encounter: Encounter): void {
  expect(encounter.waves.length, encounter.id).toBeGreaterThan(0);
  encounter.waves.forEach((wave, i) => {
    const cells = new Set<string>();
    for (const spawn of wave.enemies) {
      expect(CURRENT_ENEMIES.has(spawn.kind), spawn.kind).toBe(true);
      expect(sideOfRow(spawn.y), `${encounter.id} ${spawn.kind}`).toBe('enemy');
      expect(cells.has(`${spawn.x},${spawn.y}`), `${encounter.id} wave ${i + 1}`).toBe(false);
      cells.add(`${spawn.x},${spawn.y}`);
    }
    const world = new World({ seed: 1, battleIndex: 1, encounter, startWave: i, skipIntro: true });
    expect(world.enemies.map((enemy) => enemy.kind)).toEqual(wave.enemies.map((spawn) => spawn.kind));
  });
}

describe('encounters', () => {
  it('contain only supported enemies in valid, distinct cells', () => {
    const ids = new Set<string>();
    for (const encounter of [...ENCOUNTERS, ...STAGES]) {
      expect(ids.has(encounter.id), encounter.id).toBe(false);
      ids.add(encounter.id);
      checkWaves(encounter);
    }
  });

  it('run stages have two or three waves of at most three enemies', () => {
    for (const stage of STAGES) {
      expect(stage.waves.length, stage.id).toBeGreaterThanOrEqual(2);
      expect(stage.waves.length, stage.id).toBeLessThanOrEqual(3);
      for (const wave of stage.waves) expect(wave.enemies.length).toBeLessThanOrEqual(3);
    }
  });

  it('keeps four supported debug battles and current lookup ids', () => {
    expect(debugEncounter(1).id).toBe('n1');
    expect(debugEncounter(9).id).toBe('n4');
    expect(encounterById('e1')?.waves[0]?.enemies.map((enemy) => enemy.kind)).toEqual(['bladdy', 'mettik']);
    expect(encounterById('s1')?.waves).toHaveLength(3);
  });
});
