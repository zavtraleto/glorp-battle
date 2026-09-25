import { describe, expect, it } from 'vitest';
import { CHIPS } from '../src/data/chips';
import { ENEMY_LEVELS } from '../src/data/enemies';
import { TUTORIAL, TUTORIAL_ENCOUNTER } from '../src/data/tutorial';
import { canAddToSelection } from '../src/sim/chips/selection';
import { shapeCells, type TargetRow } from '../src/sim/chips/patterns';
import { bannerCovers } from '../src/terminal/bannerFont';
import { t } from '../src/i18n';
import { tuning } from '../src/config/tuning';
import { COLS, ENEMY_ROWS, ROWS } from '../src/sim/grid';

describe('tutorial script', () => {
  it('is one encounter with a lesson per wave, each with at least one beat', () => {
    expect(TUTORIAL).toHaveLength(4);
    expect(TUTORIAL_ENCOUNTER.waves).toHaveLength(TUTORIAL.length);
    for (const s of TUTORIAL) expect(s.beats.length).toBeGreaterThan(0);
  });

  it('points a select callout only at chips the lesson has', () => {
    for (const s of TUTORIAL) {
      const ids = s.folder.map((c) => c.defId);
      for (const b of s.beats) for (const id of b.callout?.chips ?? []) expect(ids).toContain(id);
    }
  });

  it('shows no callout in the final battle', () => {
    expect(TUTORIAL[3]!.beats.some((b) => b.callout)).toBe(false);
  });

  it('uses real chips', () => {
    for (const s of TUTORIAL) {
      for (const c of s.folder) expect(CHIPS[c.defId]).toBeDefined();
    }
  });

  it('starts every hand from chips that are in that step folder', () => {
    for (const s of TUTORIAL) {
      const pool = s.folder.map((c) => c.defId);
      for (const h of s.hand) {
        if (!h) continue;
        const at = pool.indexOf(h.defId);
        expect(at).toBeGreaterThanOrEqual(0);
        pool.splice(at, 1);
      }
      expect(s.hand.length).toBeLessThanOrEqual(tuning.chips.HAND_SIZE);
    }
  });

  it('places enemies inside the enemy area', () => {
    for (const w of TUTORIAL_ENCOUNTER.waves) {
      expect(w.enemies.length).toBeGreaterThan(0);
      for (const e of w.enemies) {
        expect(e.x).toBeGreaterThanOrEqual(0);
        expect(e.x).toBeLessThan(COLS);
        expect(e.y).toBeGreaterThanOrEqual(0);
        expect(e.y).toBeLessThan(ROWS / 2);
      }
    }
  });

  it('can draw every callout word in the 3D banner face', () => {
    for (const s of TUTORIAL) {
      for (const b of s.beats) if (b.callout) expect(bannerCovers(t(b.callout.text)), b.id).toBe(true);
    }
  });

  it('has unique beat ids', () => {
    const ids = TUTORIAL.flatMap((s) => s.beats.map((b) => `${s.id}/${b.id}`));
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Cross-cutting facts the tutorial's lessons silently depend on (task 7 brief).
  // A balance change that breaks one of these must break a test, not a lesson.
  describe('lessons stay true under balance changes', () => {
    it('lesson 1: the Cannon one-shots the tutorial Mettik', () => {
      const step1 = TUTORIAL[0]!;
      const mettik = TUTORIAL_ENCOUNTER.waves[0]!.enemies[0];
      expect(mettik).toBeDefined();
      const mettikHp = Math.round(tuning.mettik.MET_HP * ENEMY_LEVELS[mettik!.level ?? 1].hp);
      const cannon = step1.folder[0];
      expect(cannon).toBeDefined();
      expect(CHIPS[cannon!.defId].power).toBe(mettikHp);
    });

    it("lesson 3: the sword's reach clears the player's own rows but reaches from a stolen one", () => {
      const step3 = TUTORIAL[2]!;
      const enemy = TUTORIAL_ENCOUNTER.waves[2]!.enemies[0];
      expect(enemy).toBeDefined();
      const swordDefId = step3.folder.find((c) => CHIPS[c.defId].kind === 'attack' && CHIPS[c.defId].useTime === 'SWORD')?.defId;
      expect(swordDefId).toBeDefined();
      const sword = CHIPS[swordDefId!];
      const noTarget: TargetRow = () => -1;
      const px = tuning.player.PLAYER_START_X;

      // From the player's own front row, the sword must not reach the enemy.
      const reachFromOwnRow = shapeCells(sword.shape, px, ENEMY_ROWS.max + 1, noTarget).map((c) => c.y);
      expect(reachFromOwnRow).not.toContain(enemy!.y);

      // From the row an AreaGrab steals (the enemy row nearest the player's
      // territory), the sword must reach it — that is the whole lesson.
      const stolenRow = ENEMY_ROWS.max;
      const reachFromStolenRow = shapeCells(sword.shape, px, stolenRow, noTarget).map((c) => c.y);
      expect(reachFromStolenRow).toContain(enemy!.y);
    });

    it('lesson 2 holds exactly two Cannons for the queue lesson', () => {
      const [first, second, third] = TUTORIAL[1]!.hand;
      expect([first?.defId, second?.defId, third]).toEqual(['cannon', 'cannon', null]);
      expect(canAddToSelection([first!], second!, tuning.chips.HAND_SIZE)).toBe(true);
    });
  });
});
