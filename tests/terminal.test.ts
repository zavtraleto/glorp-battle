import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, tuning } from '../src/config/tuning';
import type { Dir } from '../src/core/input/commands';
import { BenchAutopilot, formatBench } from '../src/debug/bench';
import { parseDebugParams } from '../src/debug/params';
import { PerfProbe, percentile } from '../src/debug/perfProbe';
import { mountCorners, screenBounds } from '../src/terminal/interaction/project';
import { PointerRouter, type RouterHandlers } from '../src/terminal/interaction/pointerRouter';
import {
  computeLayout,
  glassRect,
  railZoneSlots,
  rectContains,
  rectToWorld,
  zoneAt,
  TERMINAL_WORLD_WIDTH,
} from '../src/terminal/layout';

beforeEach(() => {
  mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING)));
});

describe('terminal tuning', () => {
  it('has layout shares that sum to 1', () => {
    const t = tuning.terminal;
    expect(t.LAYOUT_CRT + t.LAYOUT_DISPLAY + t.LAYOUT_RAIL + t.LAYOUT_DECK).toBeCloseTo(1, 5);
  });

  it('keeps the CRT render target portrait', () => {
    expect(tuning.terminal.CRT_RES_H).toBeGreaterThan(tuning.terminal.CRT_RES_W);
  });
});

describe('terminal URL params', () => {
  it('has no terminal overrides by default', () => {
    const p = parseDebugParams('');
    expect(p.rscale).toBeNull();
    expect(p.crtres).toBeNull();
    expect(p.bench).toBe(false);
    expect(p.hitzones).toBe(false);
  });

  it('parses rscale, crtres, bench and hitzones', () => {
    const p = parseDebugParams('?rscale=300&crtres=160x240&bench=1&hitzones=1');
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
    // No top bar: the CRT starts at the top edge.
    expect(l.crt.y).toBe(0);
    expect(l.deck.y + l.deck.h).toBeCloseTo(844, 5);
    expect(l.crt.h + l.display.h + l.rail.h + l.deck.h).toBeCloseTo(844, 5);
  });

  it('gives the CRT almost the whole width of a phone', () => {
    const l = computeLayout(390, 844);
    const aspect = tuning.terminal.CRT_RES_W / tuning.terminal.CRT_RES_H;
    expect(glassRect(l, aspect).w).toBeGreaterThan(390 * 0.9);
  });

  it('puts the pause key in the bottom-left corner of the deck, clear of the ball', () => {
    const l = computeLayout(390, 844);
    const p = l.zones.pause;
    expect(p.x).toBe(l.body.x);
    expect(p.y + p.h).toBeCloseTo(l.deck.y + l.deck.h, 5);
    const ringLeft = l.body.x + l.body.w / 2 - (l.body.w * tuning.terminal.RING_W) / 2;
    expect(p.x + p.w).toBeLessThan(ringLeft);
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
    tuning.terminal.LAYOUT_DECK = 0.6; // sum > 1
    const l = computeLayout(390, 844);
    expect(l.crt.h + l.display.h + l.rail.h + l.deck.h).toBeCloseTo(844, 5);
  });

  // The trackball is the only battle organ, so it owns the whole deck (spec §11.2).
  it('gives the trackball the whole deck', () => {
    const l = computeLayout(390, 844);
    const { trackball } = l.zones;
    expect(trackball.x).toBeCloseTo(l.deck.x, 5);
    expect(trackball.w).toBeCloseTo(l.deck.w, 5);
    expect(trackball.y).toBeCloseTo(l.deck.y, 5);
    expect(trackball.h).toBeCloseTo(l.deck.h, 5);
  });

  it('has three organs: pause, the chip rail and the trackball', () => {
    const l = computeLayout(390, 844);
    expect(Object.keys(l.zones).sort()).toEqual(['pause', 'rail', 'trackball']);
  });

  it('puts the segment display between the unchanged CRT and the chip rail', () => {
    const l = computeLayout(390, 844);
    expect(l.display.y).toBeCloseTo(l.crt.y + l.crt.h, 5);
    expect(l.rail.y).toBeCloseTo(l.display.y + l.display.h, 5);
    expect(l.deck.y).toBeCloseTo(l.rail.y + l.rail.h, 5);
    expect(l.display.h).toBeGreaterThan(0);
    expect(l.display.h).toBeLessThan(l.rail.h * 0.26);
  });

  it('never lets the framed segment display take a tap', () => {
    const l = computeLayout(390, 844);
    expect(zoneAt(l, l.display.x + l.display.w / 2, l.display.y + l.display.h / 2)).toBeNull();
  });

  // The rail is tapped mid-dodge, so its zone reaches past the cartridges.
  it('gives the rail a zone taller than the cartridges themselves', () => {
    const l = computeLayout(390, 844);
    expect(l.zones.rail.y).toBeLessThanOrEqual(l.rail.y);
    expect(l.zones.rail.y + l.zones.rail.h).toBeGreaterThan(l.rail.y + l.rail.h);
    expect(l.zones.rail.h).toBeGreaterThan(l.rail.h);
  });

  // A rail zone reaching into the deck would eat trackball gestures.
  it('keeps the rail zone clear of the trackball', () => {
    const l = computeLayout(390, 844);
    expect(l.zones.rail.y + l.zones.rail.h).toBeLessThan(l.zones.trackball.y + l.deck.h * 0.15);
    expect(zoneAt(l, l.zones.trackball.x + l.zones.trackball.w / 2, l.zones.trackball.y + l.deck.h / 2)).toBe('trackball');
  });

  it('splits the rail zone into five slots that do not overlap', () => {
    const l = computeLayout(390, 844);
    const slots = railZoneSlots(l);
    expect(slots).toHaveLength(5);
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i]!.x).toBeGreaterThanOrEqual(slots[i - 1]!.x + slots[i - 1]!.w - 1e-6);
    }
    for (const r of slots) expect(r.w).toBeGreaterThanOrEqual(48);
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
    const crt = rectToWorld(l, l.crt);
    expect(crt.cy).toBeGreaterThan(0); // y up
  });
});

function makeRouter() {
  const layout = computeLayout(390, 844);
  const log: string[] = [];
  const rolls: [number, number][] = [];
  const holds: (Dir | null)[] = [];
  const handlers: RouterHandlers = {
    press: (z) => log.push(`press:${z}`),
    release: (z) => log.push(`release:${z}`),
    move: (d: Dir) => log.push(`move:${d}`),
    hold: (d: Dir | null) => holds.push(d),
    roll: (dx, dy) => rolls.push([dx, dy]),
    action: (z) => log.push(`action:${z}`),
  };
  const clock = { now: 0 };
  const router = new PointerRouter(
    (x, y) => zoneAt(layout, x, y),
    handlers,
    () => clock.now,
  );
  const center = (z: keyof typeof layout.zones) => {
    const r = layout.zones[z];
    return [r.x + r.w / 2, r.y + r.h / 2] as const;
  };
  return { layout, log, rolls, holds, router, center, clock };
}

describe('PointerRouter', () => {
  it('fires pause on press', () => {
    const { router, log, center } = makeRouter();
    const [x, y] = center('pause');
    expect(router.down(1, x, y)).toBe(true);
    router.up(1);
    expect(log).toEqual(['press:pause', 'action:pause', 'release:pause']);
  });

  // A tap on the ball is the chip shot; it can only fire on release, because a
  // gesture that turns into a step must not also shoot (spec §11.2).
  it('turns a tap on the trackball into an action on release', () => {
    const { router, log, center, clock } = makeRouter();
    const [x, y] = center('trackball');
    router.down(1, x, y);
    router.move(1, x + 2, y + 1);
    expect(log).toEqual(['press:trackball']);
    clock.now = 0.1;
    router.up(1);
    expect(log).toEqual(['press:trackball', 'action:trackball', 'release:trackball']);
  });

  it('does not shoot when the gesture produced a step', () => {
    const { router, log, center, clock } = makeRouter();
    const [x, y] = center('trackball');
    router.down(1, x, y);
    router.move(1, x + 90, y);
    clock.now = 0.1;
    router.up(1);
    expect(log).not.toContain('action:trackball');
  });

  it('does not shoot when the finger rested past the tap window', () => {
    const { router, log, center, clock } = makeRouter();
    const [x, y] = center('trackball');
    router.down(1, x, y);
    clock.now = 1.0;
    router.up(1);
    expect(log).not.toContain('action:trackball');
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

  it('holds the swiped direction until the trackball pointer is released', () => {
    const { router, log, holds, center } = makeRouter();
    const [x, y] = center('trackball');
    router.down(1, x, y);
    router.move(1, x + 30, y);
    router.move(1, x + 90, y);
    router.up(1);

    expect(log.filter((line) => line.startsWith('move:'))).toEqual(['move:right']);
    expect(holds).toEqual(['right', null]);
  });

  it('changes the held direction when the same gesture turns', () => {
    const { router, log, holds, center } = makeRouter();
    const [x, y] = center('trackball');
    router.down(1, x, y);
    router.move(1, x + 30, y);
    router.move(1, x + 30, y - 30);
    router.up(1);

    expect(log.filter((line) => line.startsWith('move:'))).toEqual(['move:right', 'move:up']);
    expect(holds).toEqual(['right', 'up', null]);
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

  it('tracks two pointers independently (trackball + pause)', () => {
    const { router, log, center } = makeRouter();
    const [tx, ty] = center('trackball');
    router.down(1, tx, ty);
    router.down(2, ...center('pause'));
    router.move(1, tx - 40, ty);
    router.up(2);
    router.up(1);
    expect(log).toEqual([
      'press:trackball',
      'press:pause',
      'action:pause',
      'move:left',
      'release:pause',
      'release:trackball',
    ]);
  });

  it('releases everything on cancelAll', () => {
    const { router, log, center } = makeRouter();
    router.down(1, ...center('trackball'));
    router.cancelAll();
    router.up(1);
    expect(log.filter((l) => l.startsWith('release:'))).toEqual(['release:trackball']);
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

describe('PointerRouter hover and gate', () => {
  it('ignores presses on refused zones', () => {
    const layout = computeLayout(390, 844);
    const log: string[] = [];
    const router = new PointerRouter((x, y) => zoneAt(layout, x, y), {
      press: (z) => log.push(`press:${z}`),
      release: () => {},
      move: () => {},
      roll: () => {},
      action: (z) => log.push(`action:${z}`),
      accepts: (z) => z === 'pause',
    });
    const tb = layout.zones.trackball;
    expect(router.down(1, tb.x + 5, tb.y + 5)).toBe(false);
    const p = layout.zones.pause;
    expect(router.down(2, p.x + 5, p.y + 5)).toBe(true);
    expect(log).toEqual(['press:pause', 'action:pause']);
  });

  it('reports the hovered zone', () => {
    const layout = computeLayout(390, 844);
    const seen: (string | null)[] = [];
    const router = new PointerRouter((x, y) => zoneAt(layout, x, y), {
      press: () => {},
      release: () => {},
      move: () => {},
      roll: () => {},
      action: () => {},
      hover: (z) => seen.push(z),
    });
    const tb = layout.zones.trackball;
    router.hoverAt(tb.x + tb.w / 2, tb.y + tb.h / 2);
    router.hoverAt(layout.crt.x + 5, layout.crt.y + 100);
    expect(seen).toEqual(['trackball', null]);
  });
});

describe('glassRect', () => {
  it('centres the CRT glass inside the CRT row with the image aspect', () => {
    const l = computeLayout(390, 844);
    const g = glassRect(l, 0.75);
    expect(g.w / g.h).toBeCloseTo(0.75, 5);
    expect(g.x + g.w / 2).toBeCloseTo(l.crt.x + l.crt.w / 2, 5);
    expect(g.y + g.h / 2).toBeCloseTo(l.crt.y + l.crt.h / 2, 5);
    expect(g.w).toBeLessThanOrEqual(l.crt.w);
  });
});

describe('zone projection', () => {
  // Tilted mounts and a moving camera mean a zone's screen rect is no longer
  // its plan rect (spec §3.1), so presses are tested against the projection.
  function camera(): THREE.PerspectiveCamera {
    const c = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    c.position.set(0, 0, 10);
    c.lookAt(0, 0, 0);
    c.updateMatrixWorld(true);
    c.updateProjectionMatrix();
    return c;
  }
  const square = (z = 0) => [
    new THREE.Vector3(-1, -1, z),
    new THREE.Vector3(1, -1, z),
    new THREE.Vector3(1, 1, z),
    new THREE.Vector3(-1, 1, z),
  ];

  it('centres a square facing the camera', () => {
    const r = screenBounds(square(), camera(), 400, 400);
    expect(r.x + r.w / 2).toBeCloseTo(200, 3);
    expect(r.y + r.h / 2).toBeCloseTo(200, 3);
    expect(r.w).toBeCloseTo(r.h, 3);
  });

  it('puts world +y at the top of the screen', () => {
    const top = screenBounds([new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0)], camera(), 400, 400);
    const bottom = screenBounds([new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, -1, 0)], camera(), 400, 400);
    expect(top.y).toBeLessThan(bottom.y);
  });

  it('foreshortens a tilted rect but keeps it centred', () => {
    const flat = screenBounds(square(), camera(), 400, 400);
    // Push the far edge away from the viewer, as a tilted deck does.
    const tilted = square();
    tilted[2]!.z = -1.2;
    tilted[3]!.z = -1.2;
    const r = screenBounds(tilted, camera(), 400, 400);
    expect(r.h).toBeLessThan(flat.h);
    expect(r.x + r.w / 2).toBeCloseTo(200, 3);
  });

  it('leaves a plan rect untouched at zero tilt', () => {
    const c = mountCorners({ cx: 0, cy: -2, w: 4, h: 2 }, 0, 0);
    expect(c.map((p) => [p.x, p.y, p.z])).toEqual([
      [-2, -1, 0],
      [2, -1, 0],
      [2, -3, 0],
      [-2, -3, 0],
    ]);
  });

  it('leans the lower edge toward the viewer and keeps the pivot put', () => {
    const c = mountCorners({ cx: 0, cy: -2, w: 4, h: 2 }, Math.PI / 6, -1);
    // Top edge sits on the pivot line and does not move.
    expect(c[0]!.y).toBeCloseTo(-1, 6);
    expect(c[0]!.z).toBeCloseTo(0, 6);
    // Bottom edge comes forward and rises toward the pivot.
    expect(c[2]!.z).toBeGreaterThan(0);
    expect(c[2]!.y).toBeGreaterThan(-3);
  });

  it('covers every corner of the rect it projects', () => {
    const tilted = square();
    tilted[0]!.z = 1.5;
    tilted[1]!.z = 1.5;
    const r = screenBounds(tilted, camera(), 400, 400);
    for (const corner of tilted) {
      const p = corner.clone().project(camera());
      const x = ((p.x + 1) / 2) * 400;
      const y = ((1 - p.y) / 2) * 400;
      expect(x).toBeGreaterThanOrEqual(r.x - 1e-6);
      expect(x).toBeLessThanOrEqual(r.x + r.w + 1e-6);
      expect(y).toBeGreaterThanOrEqual(r.y - 1e-6);
      expect(y).toBeLessThanOrEqual(r.y + r.h + 1e-6);
    }
  });
});
