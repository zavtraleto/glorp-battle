import { describe, expect, it } from 'vitest';
import { ATTRACT_PATTERN_BEATS, ATTRACT_PATTERNS, attractLevel, attractPattern } from '../src/terminal/chips/railAttract';

// Slow, soft casino lights of the idle rail (TERMINAL.md §6.3).
const STEP = 0.45;
const SLOTS = 5;
const SPAN = ATTRACT_PATTERN_BEATS * STEP;
const levels = (t: number) => Array.from({ length: SLOTS }, (_, i) => attractLevel(i, SLOTS, t, STEP));

describe('rail attract lights', () => {
  it('stays dark before it starts', () => {
    expect(levels(-0.1)).toEqual([0, 0, 0, 0, 0]);
  });

  it('keeps every level between 0 and 1 at any time', () => {
    for (let t = 0; t < SPAN * ATTRACT_PATTERNS * 2; t += 0.037) {
      for (const v of levels(t)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('never jumps: brightness changes gently from frame to frame', () => {
    const dt = 1 / 60;
    for (let t = 0; t < SPAN * ATTRACT_PATTERNS; t += dt) {
      const a = levels(t);
      const b = levels(t + dt);
      for (let i = 0; i < SLOTS; i++) expect(Math.abs((b[i] as number) - (a[i] as number))).toBeLessThan(0.08);
    }
  });

  it('glides a light from left to right first', () => {
    const brightest = (t: number) => levels(t).indexOf(Math.max(...levels(t)));
    expect(brightest(STEP * 2)).toBe(2);
    expect(brightest(STEP * 4)).toBe(4);
    expect(brightest(STEP * 3)).toBe(3);
  });

  it('then lights from the centre out, symmetrically', () => {
    const t = SPAN + STEP * 1.5;
    expect(attractPattern(t, STEP)).toBe(1);
    const at = levels(t);
    expect(at[1]).toBeCloseTo(at[3] as number, 10);
    expect(at[0]).toBeCloseTo(at[4] as number, 10);
  });

  it('cycles through every pattern and starts over', () => {
    const seen = new Set<number>();
    for (let i = 0; i < ATTRACT_PATTERNS; i++) seen.add(attractPattern(i * SPAN + 0.01, STEP));
    expect(seen.size).toBe(ATTRACT_PATTERNS);
    expect(attractPattern(ATTRACT_PATTERNS * SPAN + 0.01, STEP)).toBe(0);
  });
});
