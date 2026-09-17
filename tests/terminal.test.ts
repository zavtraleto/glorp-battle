import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, tuning } from '../src/config/tuning';
import type { Dir } from '../src/core/input/commands';
import { BenchAutopilot, formatBench } from '../src/debug/bench';
import { parseDebugParams } from '../src/debug/params';
import { PerfProbe, percentile } from '../src/debug/perfProbe';
import { PointerRouter, type RouterHandlers } from '../src/terminal/interaction/pointerRouter';
import { computeLayout, rectContains, rectToWorld, zoneAt, TERMINAL_WORLD_WIDTH } from '../src/terminal/layout';

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

function makeRouter() {
  const layout = computeLayout(390, 844);
  const log: string[] = [];
  const rolls: [number, number][] = [];
  const handlers: RouterHandlers = {
    press: (z) => log.push(`press:${z}`),
    release: (z) => log.push(`release:${z}`),
    move: (d: Dir) => log.push(`move:${d}`),
    roll: (dx, dy) => rolls.push([dx, dy]),
    action: (z) => log.push(`action:${z}`),
  };
  const router = new PointerRouter(() => layout, handlers);
  const center = (z: keyof typeof layout.zones) => {
    const r = layout.zones[z];
    return [r.x + r.w / 2, r.y + r.h / 2] as const;
  };
  return { layout, log, rolls, router, center };
}

describe('PointerRouter', () => {
  it('fires execute on press and releases on up', () => {
    const { router, log, center } = makeRouter();
    const [x, y] = center('execute');
    expect(router.down(1, x, y)).toBe(true);
    router.up(1);
    expect(log).toEqual(['press:execute', 'action:execute', 'release:execute']);
  });

  it('fires chip select and pause on press', () => {
    const { router, log, center } = makeRouter();
    router.down(1, ...center('chipSelect'));
    router.down(2, ...center('pause'));
    expect(log).toContain('action:chipSelect');
    expect(log).toContain('action:pause');
  });

  it('turns one trackball gesture into exactly one step', () => {
    const { router, log, rolls, center } = makeRouter();
    const [x, y] = center('trackball');
    router.down(1, x, y);
    router.move(1, x + 10, y);
    router.move(1, x + 30, y);
    router.move(1, x + 90, y + 5);
    router.up(1);
    expect(log.filter((l) => l.startsWith('move:'))).toEqual(['move:right']);
    expect(log).not.toContain('action:trackball');
    expect(rolls.reduce((s, r) => s + r[0], 0)).toBe(90);
  });

  it('keeps the gesture alive outside the zone', () => {
    const { router, log, center, layout } = makeRouter();
    const [x, y] = center('trackball');
    router.down(1, x, y);
    router.move(1, x, layout.crt.y + 10); // far up, over the CRT
    expect(log).toContain('move:up');
  });

  it('ignores presses outside any zone', () => {
    const { router, log, layout } = makeRouter();
    expect(router.down(1, layout.crt.x + 5, layout.crt.y + 100)).toBe(false);
    router.move(1, layout.crt.x + 100, layout.crt.y + 100);
    router.up(1);
    expect(log).toEqual([]);
  });

  it('tracks two pointers independently (trackball + execute)', () => {
    const { router, log, center } = makeRouter();
    const [tx, ty] = center('trackball');
    router.down(1, tx, ty);
    router.down(2, ...center('execute'));
    router.move(1, tx - 40, ty);
    router.up(2);
    router.up(1);
    expect(log).toEqual([
      'press:trackball',
      'press:execute',
      'action:execute',
      'move:left',
      'release:execute',
      'release:trackball',
    ]);
  });

  it('releases everything on cancelAll', () => {
    const { router, log, center } = makeRouter();
    router.down(1, ...center('execute'));
    router.cancelAll();
    router.up(1);
    expect(log.filter((l) => l.startsWith('release:'))).toEqual(['release:execute']);
  });
});

describe('PerfProbe', () => {
  it('computes nearest-rank percentiles', () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(s, 50)).toBe(5);
    expect(percentile(s, 95)).toBe(10);
    expect(percentile([], 50)).toBe(0);
  });

  it('keeps a rolling window of samples', () => {
    const p = new PerfProbe(4);
    for (const v of [100, 100, 1, 2, 3, 4]) p.record(v, v / 2);
    const s = p.snapshot();
    expect(s.frames).toBe(4);
    expect(s.intervalP95).toBe(4);
    expect(s.cpuP50).toBe(1);
  });

  it('reports gpu counters and resets', () => {
    const p = new PerfProbe();
    p.record(16, 3);
    p.setGpu(42, 1234, 1_000_000, 400, 866);
    expect(p.snapshot()).toMatchObject({ calls: 42, triangles: 1234, textureBytes: 1_000_000, renderW: 400, renderH: 866 });
    p.reset();
    expect(p.snapshot().frames).toBe(0);
  });
});

describe('BenchAutopilot', () => {
  it('issues moves and chip uses deterministically and stops after the duration', () => {
    const a = new BenchAutopilot(7, 2);
    const b = new BenchAutopilot(7, 2);
    const out: string[] = [];
    for (let i = 0; i < 180; i++) {
      const ca = a.frame(1 / 60);
      const cb = b.frame(1 / 60);
      expect(ca).toEqual(cb);
      for (const c of ca) out.push(c.type);
    }
    expect(out).toContain('move');
    expect(out).toContain('useChip');
    expect(a.done).toBe(true);
    expect(a.frame(1 / 60)).toEqual([]);
  });

  it('formats a readable report', () => {
    const s = formatBench({
      seconds: 20,
      snapshot: {
        frames: 1200,
        intervalP50: 16.6,
        intervalP95: 17.4,
        cpuP50: 2.1,
        cpuP95: 3.4,
        calls: 61,
        triangles: 4210,
        textureBytes: 1_075_200,
        renderW: 400,
        renderH: 866,
      },
    });
    expect(s).toContain('cpu p95 3.40 ms');
    expect(s).toContain('calls 61');
  });
});
