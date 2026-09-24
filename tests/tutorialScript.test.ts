import { describe, expect, it } from 'vitest';
import { CHIPS } from '../src/data/chips';
import { ENEMY_LEVELS } from '../src/data/enemies';
import { TUTORIAL } from '../src/data/tutorial';
import { canAddToSelection } from '../src/sim/chips/selection';
import { shapeCells, type TargetRow } from '../src/sim/chips/patterns';
import { DISPLAY_CHARS } from '../src/terminal/chips/segmentFont';
import { t } from '../src/i18n';
import { tuning } from '../src/config/tuning';
import { COLS, ENEMY_ROWS, ROWS } from '../src/sim/grid';

describe('tutorial script', () => {
  it('is four steps, each with at least one beat', () => {
    expect(TUTORIAL).toHaveLength(4);
    for (const s of TUTORIAL) expect(s.beats.length).toBeGreaterThan(0);
  });

  it('uses real chips and codes they can carry', () => {
    for (const s of TUTORIAL) {
      for (const c of s.folder) {
        expect(CHIPS[c.defId]).toBeDefined();
        expect(CHIPS[c.defId].codes).toContain(c.code);
      }
    }
  });

  it('starts every hand from chips that are in that step folder', () => {
    for (const s of TUTORIAL) {
      const pool = s.folder.map((c) => `${c.defId}:${c.code}`);
      for (const h of s.hand) {
        if (!h) continue;
        const at = pool.indexOf(`${h.defId}:${h.code}`);
        expect(at).toBeGreaterThanOrEqual(0);
        pool.splice(at, 1);
      }
      expect(s.hand.length).toBeLessThanOrEqual(tuning.chips.HAND_SIZE);
    }
  });

  it('places enemies inside the enemy area', () => {
    for (const s of TUTORIAL) {
      expect(s.encounter.waves[0]!.enemies.length).toBeGreaterThan(0);
      for (const e of s.encounter.waves[0]!.enemies) {
        expect(e.x).toBeGreaterThanOrEqual(0);
        expect(e.x).toBeLessThan(COLS);
        expect(e.y).toBeGreaterThanOrEqual(0);
        expect(e.y).toBeLessThan(ROWS / 2);
      }
    }
  });

  it('keeps every segment hint inside the display', () => {
    for (const s of TUTORIAL) {
      for (const b of s.beats) {
        if (!b.seg) continue;
        const text = t(b.seg);
        expect(text).toBe(text.toUpperCase());
        expect(text.length).toBeLessThanOrEqual(DISPLAY_CHARS);
      }
    }
  });

  it('has unique beat ids', () => {
    const ids = TUTORIAL.flatMap((s) => s.beats.map((b) => `${s.id}/${b.id}`));
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Cross-cutting facts the tutorial's lessons silently depend on (task 7 brief).
  // A balance change that breaks one of these must break a test, not a lesson.
  describe('lessons stay true under balance changes', () => {
    it('battle 1: the Cannon one-shots the tutorial Mettik', () => {
      const step1 = TUTORIAL[0]!;
      const mettik = step1.encounter.waves[0]!.enemies[0];
      expect(mettik).toBeDefined();
      const mettikHp = Math.round(tuning.mettik.MET_HP * ENEMY_LEVELS[mettik!.level ?? 1].hp);
      const cannon = step1.folder[0];
      expect(cannon).toBeDefined();
      expect(CHIPS[cannon!.defId].power).toBe(mettikHp);
    });

    it("battle 3: the sword's reach clears the player's own row but reaches a stolen one", () => {
      const step3 = TUTORIAL[2]!;
      const enemy = step3.encounter.waves[0]!.enemies[0];
      expect(enemy).toBeDefined();
      const swordDefId = step3.folder.find((c) => CHIPS[c.defId].kind === 'attack' && CHIPS[c.defId].useTime === 'SWORD')?.defId;
      expect(swordDefId).toBeDefined();
      const sword = CHIPS[swordDefId!];
      const noTarget: TargetRow = () => -1;
      const px = tuning.player.PLAYER_START_X;

      // From the player's own starting row, the sword must not reach the enemy.
      const reachFromOwnRow = shapeCells(sword.shape, px, tuning.player.PLAYER_START_Y, noTarget).map((c) => c.y);
      expect(reachFromOwnRow).not.toContain(enemy!.y);

      // From the row a PanlGrab steals (the enemy row nearest the player's
      // territory), the sword must reach it — that is the whole lesson.
      const stolenRow = ENEMY_ROWS.max;
      const reachFromStolenRow = shapeCells(sword.shape, px, stolenRow, noTarget).map((c) => c.y);
      expect(reachFromStolenRow).toContain(enemy!.y);
    });

    it('battle 2 contains exactly two neutral-code Cannons for the queue lesson', () => {
      const [first, second, third] = TUTORIAL[1]!.hand;
      expect([first?.defId, second?.defId, third]).toEqual(['cannon', 'cannon', null]);
      expect([first?.code, second?.code]).toEqual(['*', '*']);
      expect(canAddToSelection([first!], second!, tuning.chips.HAND_SIZE)).toBe(true);
    });
  });
});
