import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, tuning } from '../src/config/tuning';
import { parseDebugParams } from '../src/debug/params';

beforeEach(() => {
  mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING)));
});

describe('terminal tuning', () => {
  it('has layout shares that sum to 1', () => {
    const t = tuning.terminal;
    expect(t.LAYOUT_TOP + t.LAYOUT_CRT + t.LAYOUT_RAIL + t.LAYOUT_DECK).toBeCloseTo(1, 5);
  });

  it('keeps the CRT render target portrait', () => {
    expect(tuning.terminal.CRT_RES_H).toBeGreaterThan(tuning.terminal.CRT_RES_W);
  });
});

describe('terminal URL params', () => {
  it('defaults to the terminal UI', () => {
    const p = parseDebugParams('');
    expect(p.ui).toBe('terminal');
    expect(p.rscale).toBeNull();
    expect(p.crtres).toBeNull();
    expect(p.bench).toBe(false);
    expect(p.hitzones).toBe(false);
  });

  it('parses ui, rscale, crtres, bench and hitzones', () => {
    const p = parseDebugParams('?ui=css&rscale=300&crtres=160x240&bench=1&hitzones=1');
    expect(p.ui).toBe('css');
    expect(p.rscale).toBe(300);
    expect(p.crtres).toEqual([160, 240]);
    expect(p.bench).toBe(true);
    expect(p.hitzones).toBe(true);
  });

  it('clamps rscale and rejects malformed crtres', () => {
    expect(parseDebugParams('?rscale=10').rscale).toBe(120);
    expect(parseDebugParams('?rscale=99999').rscale).toBe(2160);
    expect(parseDebugParams('?crtres=abc').crtres).toBeNull();
    expect(parseDebugParams('?crtres=0x10').crtres).toBeNull();
  });
});

import { computeLayout, rectContains, rectToWorld, zoneAt, TERMINAL_WORLD_WIDTH } from '../src/terminal/layout';

describe('terminal layout', () => {
  it('fills a typical phone viewport edge to edge', () => {
    const l = computeLayout(390, 844); // aspect 0.462, inside [0.42, 0.62]
    expect(l.body).toEqual({ x: 0, y: 0, w: 390, h: 844 });
    expect(l.top.y).toBe(0);
    expect(l.deck.y + l.deck.h).toBeCloseTo(844, 5);
    expect(l.top.h + l.crt.h + l.rail.h + l.deck.h).toBeCloseTo(844, 5);
  });

  it('pillarboxes a wide desktop viewport', () => {
    const l = computeLayout(1600, 900);
    expect(l.body.h).toBe(900);
    expect(l.body.w).toBeCloseTo(900 * 0.62, 5);
    expect(l.body.x).toBeCloseTo((1600 - l.body.w) / 2, 5);
  });

  it('letterboxes a very tall viewport', () => {
    const l = computeLayout(300, 900); // aspect 0.333 < 0.42
    expect(l.body.w).toBe(300);
    expect(l.body.h).toBeCloseTo(300 / 0.42, 5);
    expect(l.body.y).toBeCloseTo((900 - l.body.h) / 2, 5);
  });

  it('normalises layout shares that do not sum to 1', () => {
    tuning.terminal.LAYOUT_DECK = 0.6; // sum 1.3
    const l = computeLayout(390, 844);
    expect(l.top.h + l.crt.h + l.rail.h + l.deck.h).toBeCloseTo(844, 5);
  });

  it('splits the deck into three non-overlapping zones that cover it', () => {
    const l = computeLayout(390, 844);
    const { chipSelect, trackball, execute } = l.zones;
    expect(chipSelect.x + chipSelect.w).toBeCloseTo(trackball.x, 5);
    expect(trackball.x + trackball.w).toBeCloseTo(execute.x, 5);
    expect(execute.x + execute.w).toBeCloseTo(l.body.x + l.body.w, 5);
    for (const z of [chipSelect, trackball, execute]) {
      expect(z.y).toBeCloseTo(l.deck.y, 5);
      expect(z.h).toBeCloseTo(l.deck.h, 5);
    }
  });

  it('keeps every zone at least 56 px on its short side on a 360×640 phone', () => {
    const l = computeLayout(360, 640);
    for (const z of Object.values(l.zones)) expect(Math.min(z.w, z.h)).toBeGreaterThanOrEqual(56);
  });

  it('finds zones by point and ignores the CRT', () => {
    const l = computeLayout(390, 844);
    const tb = l.zones.trackball;
    expect(zoneAt(l, tb.x + tb.w / 2, tb.y + tb.h / 2)).toBe('trackball');
    expect(zoneAt(l, l.crt.x + l.crt.w / 2, l.crt.y + l.crt.h / 2)).toBeNull();
    const p = l.zones.pause;
    expect(zoneAt(l, p.x + 1, p.y + 1)).toBe('pause');
    expect(rectContains(p, p.x + p.w, p.y)).toBe(false); // right edge is exclusive
  });

  it('maps the body rect to the full world face', () => {
    const l = computeLayout(390, 844);
    const w = rectToWorld(l, l.body);
    expect(w.cx).toBeCloseTo(0, 5);
    expect(w.cy).toBeCloseTo(0, 5);
    expect(w.w).toBeCloseTo(TERMINAL_WORLD_WIDTH, 5);
    expect(w.h).toBeCloseTo(l.worldHeight, 5);
    const top = rectToWorld(l, l.top);
    expect(top.cy).toBeGreaterThan(0); // y up
  });
});
