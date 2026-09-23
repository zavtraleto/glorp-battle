import { describe, expect, it } from 'vitest';
import { debugEncounter, encounterById, ENCOUNTERS } from '../src/data/encounters';
import { sideOfRow } from '../src/sim/grid';
import { World } from '../src/sim/world';

const CURRENT_ENEMIES = new Set(['mettik', 'canodron', 'hopzap', 'bladdy']);

describe('encounters', () => {
  it('contain only supported enemies in valid, distinct cells', () => {
    const ids = new Set<string>();
    for (const encounter of ENCOUNTERS) {
      expect(ids.has(encounter.id), encounter.id).toBe(false);
      ids.add(encounter.id);
      const cells = new Set<string>();
      for (const spawn of encounter.enemies) {
        expect(CURRENT_ENEMIES.has(spawn.kind), spawn.kind).toBe(true);
        expect(sideOfRow(spawn.y), `${encounter.id} ${spawn.kind}`).toBe('enemy');
        expect(cells.has(`${spawn.x},${spawn.y}`), encounter.id).toBe(false);
        cells.add(`${spawn.x},${spawn.y}`);
      }
      const world = new World({ seed: 1, battleIndex: 1, encounter, skipIntro: true });
      expect(world.enemies.map((enemy) => enemy.kind)).toEqual(encounter.enemies.map((spawn) => spawn.kind));
    }
  });

  it('keeps four supported debug battles and current lookup ids', () => {
    expect(debugEncounter(1).id).toBe('n1');
    expect(debugEncounter(9).id).toBe('n4');
    expect(encounterById('e1')?.enemies.map((enemy) => enemy.kind)).toEqual(['bladdy', 'mettik']);
  });
});
