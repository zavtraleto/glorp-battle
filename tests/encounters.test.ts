import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import { ENEMY_SEEDS } from '../src/data/enemies';
import { debugEncounter, encounterById, ENCOUNTERS } from '../src/data/encounters';
import { Monolith } from '../src/sim/enemies/monolith';
import { sideOfRow } from '../src/sim/grid';
import { World } from '../src/sim/world';

// Encounters as data and the Monolith boss (roguelite spec §5.3–5.4).

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

describe('encounters', () => {
  it('are valid battles', () => {
    const ids = new Set<string>();
    for (const enc of ENCOUNTERS) {
      expect(ids.has(enc.id), enc.id).toBe(false);
      ids.add(enc.id);
      const cells = new Set<string>();
      for (const s of enc.enemies) {
        expect(sideOfRow(s.y), `${enc.id} ${s.kind}`).toBe('enemy');
        expect(cells.has(`${s.x},${s.y}`), enc.id).toBe(false);
        cells.add(`${s.x},${s.y}`);
        expect(ENEMY_SEEDS[s.kind], s.kind).toBeTypeOf('number');
      }
      for (const p of enc.panels ?? []) {
        expect(cells.has(`${p.x},${p.y}`), enc.id).toBe(false);
        expect(`${p.x},${p.y}`, enc.id).not.toBe('1,4'); // the player's start
      }
      const w = new World({ seed: 1, battleIndex: 1, encounter: enc, skipIntro: true });
      expect(w.enemies.map((e) => e.kind)).toEqual(enc.enemies.map((s) => s.kind));
      for (const p of enc.panels ?? []) expect(w.field.panel(p.x, p.y)).toBe(p.panel);
    }
  });

  it('cover every depth of every tier', () => {
    for (let depth = 1; depth <= 9; depth++) {
      const normal = ENCOUNTERS.filter((e) => e.tier === 'normal' && e.minDepth <= depth && depth <= e.maxDepth);
      expect(normal.length, `normal ${depth}`).toBeGreaterThanOrEqual(3);
      if (depth >= 3) {
        const elite = ENCOUNTERS.filter((e) => e.tier === 'elite' && e.minDepth <= depth && depth <= e.maxDepth);
        expect(elite.length, `elite ${depth}`).toBeGreaterThanOrEqual(1);
      }
    }
    expect(ENCOUNTERS.filter((e) => e.tier === 'boss').map((e) => e.minDepth)).toEqual([10]);
  });

  it('keep the old battles 1–4 for debug jumps', () => {
    expect(debugEncounter(1).id).toBe('n1');
    expect(debugEncounter(9).id).toBe('n4');
    expect(encounterById('boss')?.tier).toBe('boss');
  });
});

describe('Monolith', () => {
  function bossWorld(): { w: World; boss: Monolith } {
    const w = new World({
      seed: 4,
      battleIndex: 1,
      encounter: encounterById('boss'),
      skipIntro: true,
      cheats: { god: true, aiEnabled: true, buster: false },
    });
    w.chips.queue = [];
    const boss = w.enemies.find((e) => e.kind === 'monolith') as Monolith;
    // Keep the escort out of the way.
    const escort = w.enemies.find((e) => e.kind !== 'monolith')!;
    escort.paralyze(T(999));
    return { w, boss };
  }

  it('has boss HP and uses all three attacks', () => {
    const { w, boss } = bossWorld();
    expect(boss.hp).toBe(tuning.monolith.MONO_HP);
    const seen = new Set<string>();
    for (let i = 0; i < T(60); i++) {
      w.step(DT);
      for (const a of w.attacks) seen.add(a.kind);
      if (w.objects.some((o) => o.side === 'enemy')) seen.add('cube');
    }
    expect([...seen].sort()).toEqual(expect.arrayContaining(['cube', 'rockfall', 'shockwave']));
  });

  it('attacks more often below half HP', () => {
    const count = (enraged: boolean) => {
      const { w, boss } = bossWorld();
      if (enraged) boss.hp = boss.maxHp * 0.4;
      let telegraphs = 0;
      let prev = boss.state;
      for (let i = 0; i < T(40); i++) {
        w.step(DT);
        if (boss.state === 'TELEGRAPH' && prev !== 'TELEGRAPH') telegraphs++;
        prev = boss.state;
      }
      return telegraphs;
    };
    expect(count(true)).toBeGreaterThan(count(false));
  });
});
