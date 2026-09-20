import { describe, expect, it } from 'vitest';
import { CHIPS } from '../src/data/chips';
import { TUTORIAL } from '../src/data/tutorial';
import { DISPLAY_CHARS } from '../src/terminal/chips/segmentFont';
import { t } from '../src/i18n';
import { tuning } from '../src/config/tuning';
import { COLS, ROWS } from '../src/sim/grid';

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
      expect(s.encounter.enemies.length).toBeGreaterThan(0);
      for (const e of s.encounter.enemies) {
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
});
