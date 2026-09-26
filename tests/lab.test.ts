import { describe, expect, it } from 'vitest';
import { encounterById, STAGES } from '../src/data/encounters';
import {
  cellContent,
  draftFromEncounter,
  emptyDraft,
  exportTs,
  paint,
  parseDraft,
  toEncounter,
  validateDraft,
} from '../src/debug/lab';
import { ENEMY_KINDS } from '../src/sim/enemies/enemyBase';
import { createEnemy } from '../src/sim/enemies/factory';
import { World } from '../src/sim/world';

// Encounter Lab (GDD §15.5): a hand editor of encounters in the debug panel.

describe('Encounter Lab model', () => {
  it('lists every enemy kind the factory builds', () => {
    for (const kind of ENEMY_KINDS) expect(createEnemy({ kind, x: 1, y: 0 }, 1, 0).kind).toBe(kind);
  });

  it('paints enemies only on the enemy side; the same brush again erases', () => {
    const d = emptyDraft();
    paint(d, 0, 1, 0, { type: 'enemy', kind: 'punchy', level: 2 });
    expect(cellContent(d, 0, 1, 0).enemy).toEqual({ kind: 'punchy', x: 1, y: 0, level: 2 });
    paint(d, 0, 1, 4, { type: 'enemy', kind: 'mettik', level: 1 });
    expect(cellContent(d, 0, 1, 4).enemy).toBeNull();
    // Another kind replaces, the same kind and level removes.
    paint(d, 0, 1, 0, { type: 'enemy', kind: 'mettik', level: 1 });
    expect(cellContent(d, 0, 1, 0).enemy?.kind).toBe('mettik');
    paint(d, 0, 1, 0, { type: 'enemy', kind: 'mettik', level: 1 });
    expect(cellContent(d, 0, 1, 0).enemy).toBeNull();
  });

  it('paints panels anywhere and erases both layers', () => {
    const d = emptyDraft();
    paint(d, 0, 2, 3, { type: 'panel', panel: 'BROKEN' });
    paint(d, 0, 0, 1, { type: 'panel', panel: 'CRACKED' });
    paint(d, 0, 0, 1, { type: 'enemy', kind: 'canodron', level: 1 });
    expect(cellContent(d, 0, 2, 3).panel).toBe('BROKEN');
    paint(d, 0, 2, 3, { type: 'panel', panel: 'BROKEN' });
    expect(cellContent(d, 0, 2, 3).panel).toBeNull();
    paint(d, 0, 0, 1, { type: 'erase' });
    expect(cellContent(d, 0, 0, 1)).toEqual({ enemy: null, panel: null });
  });

  it('round-trips every stage through the draft', () => {
    for (const stage of STAGES) {
      const back = toEncounter(draftFromEncounter(stage));
      expect(back.waves).toEqual(stage.waves);
      expect(back.id).toBe(stage.id);
    }
  });

  it('flags empty waves and enemies standing on holes', () => {
    const d = emptyDraft();
    expect(validateDraft(d)).toEqual(['wave 1: no enemies']);
    paint(d, 0, 1, 1, { type: 'enemy', kind: 'mettik', level: 1 });
    paint(d, 0, 1, 1, { type: 'panel', panel: 'BROKEN' });
    expect(validateDraft(d)).toEqual(['wave 1: enemy on a hole at 1,1']);
  });

  it('exports a TS fragment in the encounters.ts style', () => {
    const d = emptyDraft();
    d.id = 'lab1';
    paint(d, 0, 1, 0, { type: 'enemy', kind: 'punchy', level: 1 });
    paint(d, 0, 0, 2, { type: 'enemy', kind: 'mettik', level: 2 });
    d.waves.push({ enemies: [], panels: [] });
    paint(d, 1, 2, 1, { type: 'enemy', kind: 'canodron', level: 1 });
    paint(d, 1, 1, 3, { type: 'panel', panel: 'CRACKED' });
    expect(exportTs(d)).toBe(
      [
        '{',
        "  id: 'lab1', tier: 'normal', minDepth: 1, maxDepth: 1,",
        '  waves: [',
        "    wave(e('punchy', 1, 0), e('mettik', 0, 2, 2)),",
        "    { enemies: [e('canodron', 2, 1)], panels: [{ x: 1, y: 3, panel: 'CRACKED' }] },",
        '  ],',
        '},',
      ].join('\n'),
    );
  });

  it('starts a world from the exported encounter', () => {
    const d = draftFromEncounter(encounterById('s4')!);
    const enc = toEncounter(d);
    const w = new World({ seed: 1, battleIndex: 1, encounter: enc, startWave: 1, skipIntro: true });
    expect(w.enemies.map((e) => e.kind)).toEqual(['hopzap', 'punchy']);
  });

  it('reads back a saved draft and drops a broken one', () => {
    const d = draftFromEncounter(encounterById('s1')!);
    expect(parseDraft(JSON.stringify(d))).toEqual(d);
    expect(parseDraft('{"waves": 3}')).toBeNull();
    expect(parseDraft('not json')).toBeNull();
  });
});
