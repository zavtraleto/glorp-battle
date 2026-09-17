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
